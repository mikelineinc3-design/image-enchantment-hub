import { FilterType, RawExifData, ImageFormat, UpscaleTarget, FileType, MicrostockMetadata, MetadataMode } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { embedExifIntoJpeg } from './exifWriter';
import { generateRawExif } from './exif';
import { embedXmpIntoJpeg, sanitizeTitle, sanitizeKeywords, IptcXmpData } from './iptcXmpWriter';
import { embedMetadataIntoPng } from './pngMetadataWriter';
import { embedMetadataIntoEpsDataUrl } from './epsMetadataWriter';
import { embedMetadataIntoSvgDataUrl } from './svgMetadataWriter';
import { runGeminiThrottled } from './geminiRateLimiter';

// Maximum dimensions to prevent memory issues
const MAX_DIMENSION = 4000;

function targetToPixels(target: UpscaleTarget): number {
  switch (target) {
    case '4mp': return 4_000_000;
    case '5mp': return 5_000_000;
    case '6mp': return 6_000_000;
    default: return 0;
  }
}

function calculateMinimumDimensions(width: number, height: number, upscale: UpscaleTarget = 'none'): { targetWidth: number; targetHeight: number } {
  const targetPixels = targetToPixels(upscale);

  // No upscale target — keep original dimensions (capped at MAX_DIMENSION)
  if (targetPixels === 0) {
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      return { targetWidth: Math.floor(width * scale), targetHeight: Math.floor(height * scale) };
    }
    return { targetWidth: width, targetHeight: height };
  }

  // Scale to exactly target megapixels (preserve aspect ratio)
  const currentPixels = width * height;
  const scale = Math.sqrt(targetPixels / currentPixels);
  let targetWidth = Math.round(width * scale);
  let targetHeight = Math.round(height * scale);

  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    const capScale = Math.min(MAX_DIMENSION / targetWidth, MAX_DIMENSION / targetHeight);
    targetWidth = Math.floor(targetWidth * capScale);
    targetHeight = Math.floor(targetHeight * capScale);
  }

  return { targetWidth, targetHeight };
}

// Detect if image has transparency (PNG with alpha)
async function hasTransparency(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(img.width, 100); // Sample small area
      canvas.height = Math.min(img.height, 100);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(false);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Check alpha channel for any transparency
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          resolve(true);
          return;
        }
      }
      resolve(false);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

const FILTER_PROMPTS: Record<string, string> = {
  vibrant: "Enhance with rich, saturated colors. Increase color intensity while maintaining natural look. Make the image pop with vivid tones.",
  cinematic: "Apply cinematic color grade with subtle teal and orange tones, adjust contrast for movie-like feel. Keep it professional and atmospheric.",
  natural: "Enhance naturally. Improve exposure, slightly boost colors while maintaining realism. Professional photograph in ideal lighting conditions.",
  default: "Enhance professionally. Improve overall quality, adjust exposure, increase color vibrancy while keeping it realistic.",
  product: "Enhance clarity, increase micro-details, improve color accuracy, reduce noise, and apply studio-style lighting with neutral background separation.",
  sharpener: "Enhance details significantly. Increase sharpness and micro-contrast for crisp, clear edges throughout the image.",
  hdr: "Improve dynamic range, recover shadow details, highlight texture, and enhance brightness while keeping the image natural and realistic."
};

function buildInlineMetadataInstruction(fileType: FileType, mode: MetadataMode, customPrompt: string | undefined, fpMode: boolean) {
  const isVector = fileType === 'eps' || fileType === 'svg';
  const vectorRule = isVector
    ? "Include vector-specific keywords (vector, eps, illustration, clipart, graphic design) where they genuinely fit."
    : "STRICTLY DO NOT include 'vector', 'eps', 'illustration', or 'clipart' keywords — this is a raster photograph.";
  const titleLimit = fpMode ? 99 : 200;
  const titleMin = fpMode ? 50 : 100;
  const keywordsLimit = fpMode ? 48 : 49;
  let instr = `\n\nAFTER producing the enhanced image, ALSO output a text part containing ONLY this strict JSON object describing the enhanced image (no prose, no markdown fences, nothing else in the text part):
{"filename":"lowercase-hyphenated.${fileType}","title":"between ${titleMin}-${titleLimit} chars, literal description then long-tail keywords","keywords":"${keywordsLimit} or fewer, lowercase, comma-separated, ~70% single word/30% two-word, top-demand first","adobeCategory":"official Adobe Stock category","shutterstockCategory":"official Shutterstock category","copyright":"Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.","rights":"Microstock Commercial License","author":"Microstock Contributor"}
${vectorRule}`;
  if (mode === 'data') {
    instr += `\nAlso include "aiTrainingNote" (<=500 chars) in that same JSON object.`;
  }
  if (customPrompt && customPrompt.trim()) {
    instr += `\nADDITIONAL USER INSTRUCTIONS (apply to title/keywords): ${customPrompt.trim()}`;
  }
  return instr;
}

interface GeminiEnhanceResult {
  imageUrl: string;
  metadata?: MicrostockMetadata;
}

// Gemini's free tier restricts requests from cloud/datacenter IPs (Supabase
// Edge Functions run on Deno Deploy) even when the same key works fine from
// a browser — a documented Google-side restriction. So call Gemini directly
// from the browser for image enhancement too, instead of via the edge function.
//
// This single call ALSO asks Gemini to return metadata JSON in its text
// response alongside the enhanced image — combining what used to be two
// separate Gemini requests (enhance + metadata) into one, halving the
// per-photo request count.
async function tryGeminiEnhanceClientSide(
  imageDataUrl: string,
  filters: FilterType[],
  isPng: boolean,
  apiKey: string,
  metaOpts?: { fileType: FileType; mode: MetadataMode; customPrompt?: string; fpMode: boolean }
): Promise<GeminiEnhanceResult | null> {
  const combinedPrompts = filters.map(f => FILTER_PROMPTS[f] || FILTER_PROMPTS.default);
  let prompt = `Enhance this photo with the following improvements:\n${combinedPrompts.join('\n')}`;
  if (isPng) {
    prompt += '\n\nCRITICAL: This is a PNG image with potential transparency. You MUST preserve any transparent areas exactly as they are. Do NOT add any background color to transparent regions. Keep the alpha channel intact.';
  }
  if (metaOpts) {
    prompt += buildInlineMetadataInstruction(metaOpts.fileType, metaOpts.mode, metaOpts.customPrompt, metaOpts.fpMode);
  }

  const base64Match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  const mimeType = base64Match?.[1] || 'image/jpeg';
  const rawBase64 = base64Match?.[2] || imageDataUrl.split(',').pop() || '';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: rawBase64 } }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.warn('[gemini-enhance-client] request failed', response.status, errText.slice(0, 200));
    return null;
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
  if (!imagePart?.inlineData) return null;
  const imageUrl = `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`;

  let metadata: MicrostockMetadata | undefined;
  if (metaOpts) {
    const textPart = parts.find((p: { text?: string }) => p.text)?.text || '';
    const jsonMatch = textPart.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const sanitizedTitle = sanitizeTitle(String(parsed.title || ''), metaOpts.fpMode ? 99 : 200);
        const sanitizedKeywords = sanitizeKeywords(String(parsed.keywords || ''), metaOpts.fpMode ? 48 : 49).join(', ');
        metadata = {
          filename: String(parsed.filename || `image.${metaOpts.fileType}`),
          title: sanitizedTitle,
          description: sanitizedTitle,
          keywords: sanitizedKeywords,
          adobeCategory: String(parsed.adobeCategory || 'Lifestyle'),
          shutterstockCategory: String(parsed.shutterstockCategory || 'Miscellaneous'),
          aiTrainingNote: typeof parsed.aiTrainingNote === 'string' ? parsed.aiTrainingNote.slice(0, 1000) : undefined,
        };
      } catch {
        // Metadata parse failed — caller will fall back to a separate metadata call.
      }
    }
  }

  return { imageUrl, metadata };
}

export interface EnhanceResult {
  enhancedDataUrl: string;
  metadata?: MicrostockMetadata;
}

export async function enhanceImageWithAI(
  imageDataUrl: string,
  filters: FilterType[],
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number,
  imageFormat: ImageFormat,
  customApiKeys?: string[],
  upscale: UpscaleTarget = 'none',
  metaOpts?: { fileType: FileType; mode: MetadataMode; customPrompt?: string; fpMode: boolean }
): Promise<EnhanceResult> {
  // Calculate target dimensions
  const { targetWidth, targetHeight } = calculateMinimumDimensions(originalWidth, originalHeight, upscale);
  
  const isPng = imageFormat === 'png';

  let enhancedDataUrl: string | undefined;
  let metadata: MicrostockMetadata | undefined;

  // Try Gemini directly from the browser first — see tryGeminiEnhanceClientSide for why.
  // This also asks for metadata JSON in the same call (see metaOpts), cutting
  // the per-photo Gemini request count in half versus a separate call.
  if (customApiKeys && customApiKeys.length > 0) {
    for (const key of customApiKeys) {
      try {
        const result = await runGeminiThrottled(() =>
          tryGeminiEnhanceClientSide(imageDataUrl, filters, isPng, key, metaOpts)
        );
        if (result) {
          console.log('[imageEnhancer] Gemini (client-side) succeeded', { gotMetadata: !!result.metadata });
          enhancedDataUrl = result.imageUrl;
          metadata = result.metadata;
          break;
        }
      } catch (e) {
        console.warn('[gemini-enhance-client] key failed, trying next:', e);
      }
    }
  }

  if (!enhancedDataUrl) {
    console.log('[imageEnhancer] Client-side Gemini unavailable, falling back to edge function (Lovable)');
    const { data, error } = await supabase.functions.invoke('enhance-image', {
      body: { 
        imageBase64: imageDataUrl, 
        filters,
        customApiKeys: undefined, // already tried client-side above; avoid a repeat failure from the same blocked server IP
        preserveFormat: isPng // Tell edge function to preserve PNG format
      }
    });

    if (error) {
      console.error('Edge function error:', error);
      throw new Error(error.message || 'Failed to enhance image');
    }

    if (data.error) {
      throw new Error(data.error);
    }

    enhancedDataUrl = data.enhancedImage;
    // No combined metadata from this fallback path — caller falls back to a separate metadata call.
  }
  
  // If original was PNG but AI returned JPEG, convert back to PNG
  if (isPng && enhancedDataUrl && !enhancedDataUrl.startsWith('data:image/png')) {
    enhancedDataUrl = await convertJpegToPng(enhancedDataUrl);
  }
  
  // Resize to target dimensions (at least 5MP), preserving format
  enhancedDataUrl = await resizeToTarget(enhancedDataUrl, targetWidth, targetHeight, imageFormat);
  
  // Only embed EXIF for JPEG (PNG doesn't support EXIF the same way)
  if (!isPng) {
    const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
    // Canvas has already baked in any EXIF rotation, so force orientation = 1
    // to prevent viewers from rotating the pixels a second time.
    completeRawExif.orientation = 1;
    enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  }
  
  return { enhancedDataUrl, metadata };
}

// Convert JPEG data URL to PNG data URL
async function convertJpegToPng(jpegDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate input
    if (!jpegDataUrl || jpegDataUrl.length < 100) {
      reject(new Error('Invalid JPEG data URL for PNG conversion'));
      return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        // Convert to PNG using blob to avoid base64 issues
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to convert to PNG blob'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            // Validate the result
            if (!result || !result.startsWith('data:image/png')) {
              reject(new Error('PNG conversion produced invalid result'));
              return;
            }
            resolve(result);
          };
          reader.onerror = () => reject(new Error('Failed to read PNG blob'));
          reader.readAsDataURL(blob);
        }, 'image/png');
      } catch (err) {
        reject(new Error(`PNG conversion error: ${err}`));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for PNG conversion'));
    img.src = jpegDataUrl;
  });
}

// Resize image to target dimensions, preserving format
async function resizeToTarget(dataUrl: string, targetWidth: number, targetHeight: number, format: ImageFormat): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate input data URL
    if (!dataUrl || dataUrl.length < 100 || !dataUrl.startsWith('data:image/')) {
      reject(new Error(`Invalid data URL for resize: ${dataUrl?.substring(0, 50) || 'empty'}`));
      return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // For PNG, don't fill background - preserve transparency
      if (format === 'png') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      
      // Use blob conversion to avoid base64 chunking issues
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const quality = format === 'png' ? undefined : 0.95;
      
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to convert to blob'));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Validate the result is a proper data URL
          if (!result || !result.startsWith('data:image/')) {
            reject(new Error('Resize produced invalid result'));
            return;
          }
          resolve(result);
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      }, mimeType, quality);
    };
    img.onerror = () => reject(new Error('Failed to load image for resize'));
    img.src = dataUrl;
  });
}

// Validate that a data URL is properly formatted for API calls
export function validateImageDataUrl(dataUrl: string): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  if (dataUrl.length < 100) return false;
  // Accept image/* AND application/postscript (EPS)
  if (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('data:application/postscript')) return false;
  if (!dataUrl.includes(',')) return false;
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex > 0 && dataUrl.length - commaIndex > 50;
}

// Embed IPTC/XMP metadata for microstock compatibility (JPEG + PNG + EPS)
export function embedIptcXmpMetadata(
  dataUrl: string,
  title: string,
  description: string,
  keywords: string,
  format: ImageFormat
): string {
  const xmpData: IptcXmpData = {
    title: sanitizeTitle(title),
    description: sanitizeTitle(description),
    keywords: sanitizeKeywords(keywords),
    author: 'Microstock Contributor',
    software: 'Adobe Photoshop',
    copyright: 'Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.',
    rights: 'Microstock Commercial License',
  };

  if (format === 'png') {
    return embedMetadataIntoPng(dataUrl, xmpData);
  }
  if (format === 'eps') {
    return embedMetadataIntoEpsDataUrl(dataUrl, xmpData);
  }
  if (format === 'svg') {
    return embedMetadataIntoSvgDataUrl(dataUrl, xmpData);
  }
  return embedXmpIntoJpeg(dataUrl, xmpData);
}

// Fallback local enhancement for when AI is unavailable
export async function enhanceImageLocally(
  imageDataUrl: string,
  filters: FilterType[],
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number,
  imageFormat: ImageFormat,
  upscale: UpscaleTarget = 'none'
): Promise<string> {
  // Validate input
  if (!imageDataUrl || imageDataUrl.length < 50) {
    throw new Error('Invalid image data URL for local enhancement');
  }
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        // Use the browser-rotated (orientation-baked) natural dimensions so
        // portrait images with EXIF orientation don't get drawn into a
        // landscape canvas (which caused the rotation bug).
        const sourceWidth = img.naturalWidth || originalWidth;
        const sourceHeight = img.naturalHeight || originalHeight;
        const { targetWidth, targetHeight } = calculateMinimumDimensions(sourceWidth, sourceHeight, upscale);
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // For PNG, clear canvas first to preserve transparency
        if (imageFormat === 'png') {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        // Only apply filter adjustments if filters are selected
        if (filters.length > 0) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          // Combine settings from all selected filters
          const combinedSettings = getCombinedFilterSettings(filters);
          
          for (let i = 0; i < data.length; i += 4) {
            // Skip fully transparent pixels for PNG
            if (imageFormat === 'png' && data[i + 3] === 0) {
              continue;
            }
            
            data[i] = Math.min(255, Math.max(0, combinedSettings.contrast * (data[i] - 128) + 128));
            data[i + 1] = Math.min(255, Math.max(0, combinedSettings.contrast * (data[i + 1] - 128) + 128));
            data[i + 2] = Math.min(255, Math.max(0, combinedSettings.contrast * (data[i + 2] - 128) + 128));
            
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = Math.min(255, Math.max(0, avg + combinedSettings.saturation * (data[i] - avg)));
            data[i + 1] = Math.min(255, Math.max(0, avg + combinedSettings.saturation * (data[i + 1] - avg)));
            data[i + 2] = Math.min(255, Math.max(0, avg + combinedSettings.saturation * (data[i + 2] - avg)));
            
            // Cinematic color grading
            if (filters.includes('cinematic')) {
              data[i] = Math.min(255, data[i] * 1.05);
              data[i + 2] = Math.min(255, data[i + 2] * 1.08);
            }
            
            // HDR shadow recovery
            if (filters.includes('hdr')) {
              const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              if (luminance < 80) {
                const boost = 1 + (80 - luminance) / 200;
                data[i] = Math.min(255, data[i] * boost);
                data[i + 1] = Math.min(255, data[i + 1] * boost);
                data[i + 2] = Math.min(255, data[i + 2] * boost);
              }
            }
          }
          
          ctx.putImageData(imageData, 0, 0);
        }
        
        // Use blob conversion to avoid base64 chunking issues with large images
        const mimeType = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
        const quality = imageFormat === 'png' ? undefined : 0.95;
        
        // Helper function to process the data URL result
        const processResult = (enhancedDataUrl: string) => {
          // Validate result
          if (!enhancedDataUrl || !enhancedDataUrl.startsWith('data:image/')) {
            reject(new Error('Local enhancement produced invalid result'));
            return;
          }
          
          // Only embed EXIF for JPEG
          if (imageFormat === 'jpeg') {
            try {
              const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
              // Canvas baked in EXIF rotation; reset orientation so viewers don't double-rotate.
              completeRawExif.orientation = 1;
              enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
            } catch (exifError) {
              console.warn('Failed to embed EXIF, continuing without it:', exifError);
            }
          }
          
          resolve(enhancedDataUrl);
        };
        
        // Try blob conversion first, fall back to toDataURL if it fails
        try {
          canvas.toBlob((blob) => {
            if (!blob) {
              // Fallback to toDataURL if toBlob returns null
              console.warn('toBlob returned null, falling back to toDataURL');
              try {
                const fallbackDataUrl = canvas.toDataURL(mimeType, quality);
                processResult(fallbackDataUrl);
              } catch (fallbackError) {
                reject(new Error(`Canvas export failed: ${fallbackError}`));
              }
              return;
            }
            
            const reader = new FileReader();
            reader.onloadend = () => {
              processResult(reader.result as string);
            };
            reader.onerror = () => {
              // Fallback to toDataURL if FileReader fails
              console.warn('FileReader failed, falling back to toDataURL');
              try {
                const fallbackDataUrl = canvas.toDataURL(mimeType, quality);
                processResult(fallbackDataUrl);
              } catch (fallbackError) {
                reject(new Error(`Canvas export failed: ${fallbackError}`));
              }
            };
            reader.readAsDataURL(blob);
          }, mimeType, quality);
        } catch (blobError) {
          // If toBlob throws, fall back to toDataURL
          console.warn('toBlob threw error, falling back to toDataURL:', blobError);
          try {
            const fallbackDataUrl = canvas.toDataURL(mimeType, quality);
            processResult(fallbackDataUrl);
          } catch (fallbackError) {
            reject(new Error(`Canvas export failed: ${fallbackError}`));
          }
        }
      } catch (err) {
        reject(new Error(`Local enhancement error: ${err}`));
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load image for local enhancement'));
    img.src = imageDataUrl;
  });
}

function getFilterSettings(filter: FilterType) {
  switch (filter) {
    case 'vibrant':
      return { contrast: 1.2, saturation: 1.4 };
    case 'cinematic':
      return { contrast: 1.15, saturation: 0.95 };
    case 'natural':
      return { contrast: 1.08, saturation: 1.1 };
    case 'product':
      return { contrast: 1.12, saturation: 1.05 };
    case 'sharpener':
      return { contrast: 1.25, saturation: 1.0 };
    case 'hdr':
      return { contrast: 1.18, saturation: 1.15 };
    default:
      return { contrast: 1.15, saturation: 1.2 };
  }
}

function getCombinedFilterSettings(filters: FilterType[]) {
  if (filters.length === 0) {
    return { contrast: 1.15, saturation: 1.2 };
  }
  
  let totalContrast = 0;
  let totalSaturation = 0;
  
  for (const filter of filters) {
    const settings = getFilterSettings(filter);
    totalContrast += settings.contrast;
    totalSaturation += settings.saturation;
  }
  
  return {
    contrast: totalContrast / filters.length,
    saturation: totalSaturation / filters.length
  };
}

// Detect image format from file or data URL
export function detectImageFormat(file: File): ImageFormat {
  const name = file.name.toLowerCase();
  if (file.type === 'application/postscript' || name.endsWith('.eps')) return 'eps';
  if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return 'svg';
  if (file.type === 'image/png') return 'png';
  // WebP is converted to a real JPEG File before this ever runs (see
  // convertWebpToJpeg in Index.tsx's upload handler) — falls through to jpeg.
  return 'jpeg';
}

// Convert a WebP File into a genuine JPEG File via canvas re-encoding.
// This must run BEFORE the file enters the rest of the pipeline (EXIF
// embedding, edge function calls, etc.), since those assume real JPEG bytes —
// a file merely relabeled "jpeg" while still containing WebP bytes would
// corrupt downstream processing.
export function convertWebpToJpeg(file: File, quality = 0.92): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      // Flatten onto white in case the WebP had alpha (JPEG has no alpha channel).
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) {
          reject(new Error('WebP to JPEG conversion failed'));
          return;
        }
        const newName = file.name.replace(/\.webp$/i, '.jpg');
        resolve(new File([blob], newName, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load WebP image'));
    };
    img.src = objectUrl;
  });
}

export function detectFormatFromDataUrl(dataUrl: string): ImageFormat {
  if (dataUrl.startsWith('data:application/postscript')) return 'eps';
  if (dataUrl.startsWith('data:image/svg+xml')) return 'svg';
  if (dataUrl.startsWith('data:image/png')) return 'png';
  return 'jpeg';
}

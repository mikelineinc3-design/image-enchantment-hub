import { FilterType, RawExifData, ImageFormat } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { embedExifIntoJpeg } from './exifWriter';
import { generateRawExif } from './exif';
import { embedXmpIntoJpeg, sanitizeTitle, sanitizeKeywords, IptcXmpData } from './iptcXmpWriter';

// Minimum 5 megapixels = 5,000,000 pixels
const MIN_MEGAPIXELS = 5000000;

function calculateMinimumDimensions(width: number, height: number): { targetWidth: number; targetHeight: number } {
  const currentPixels = width * height;
  
  if (currentPixels >= MIN_MEGAPIXELS) {
    return { targetWidth: width, targetHeight: height };
  }
  
  // Scale up to meet minimum 5MP
  const scale = Math.sqrt(MIN_MEGAPIXELS / currentPixels);
  const targetWidth = Math.ceil(width * scale);
  const targetHeight = Math.ceil(height * scale);
  
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

export async function enhanceImageWithAI(
  imageDataUrl: string,
  filters: FilterType[],
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number,
  imageFormat: ImageFormat,
  customApiKeys?: string[]
): Promise<string> {
  // Calculate target dimensions (at least 5MP)
  const { targetWidth, targetHeight } = calculateMinimumDimensions(originalWidth, originalHeight);
  
  const isPng = imageFormat === 'png';
  
  const { data, error } = await supabase.functions.invoke('enhance-image', {
    body: { 
      imageBase64: imageDataUrl, 
      filters,
      customApiKeys,
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

  let enhancedDataUrl = data.enhancedImage;
  
  // If original was PNG but AI returned JPEG, convert back to PNG
  if (isPng && enhancedDataUrl && !enhancedDataUrl.startsWith('data:image/png')) {
    enhancedDataUrl = await convertJpegToPng(enhancedDataUrl);
  }
  
  // Resize to target dimensions (at least 5MP), preserving format
  enhancedDataUrl = await resizeToTarget(enhancedDataUrl, targetWidth, targetHeight, imageFormat);
  
  // Only embed EXIF for JPEG (PNG doesn't support EXIF the same way)
  if (!isPng) {
    const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
    enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  }
  
  return enhancedDataUrl;
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
          resolve(reader.result as string);
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      }, mimeType, quality);
    };
    img.onerror = () => reject(new Error('Failed to load image for resize'));
    img.src = dataUrl;
  });
}

// Embed IPTC/XMP metadata for microstock compatibility
export function embedIptcXmpMetadata(
  dataUrl: string, 
  title: string, 
  description: string, 
  keywords: string,
  format: ImageFormat
): string {
  // Only embed IPTC/XMP in JPEG files - PNG uses different metadata format
  if (format === 'png') {
    return dataUrl; // Return as-is for PNG
  }
  
  const xmpData: IptcXmpData = {
    title: sanitizeTitle(title),
    description: sanitizeTitle(description),
    keywords: sanitizeKeywords(keywords),
    author: 'scode',
    software: 'Adobe Photoshop',
  };
  
  return embedXmpIntoJpeg(dataUrl, xmpData);
}

// Fallback local enhancement for when AI is unavailable
export async function enhanceImageLocally(
  imageDataUrl: string,
  filters: FilterType[],
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number,
  imageFormat: ImageFormat
): Promise<string> {
  // Calculate target dimensions (at least 5MP)
  const { targetWidth, targetHeight } = calculateMinimumDimensions(originalWidth, originalHeight);
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      
      if (ctx) {
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
      }
      resolve();
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  // Use correct format
  const mimeType = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const quality = imageFormat === 'png' ? undefined : 0.95;
  let enhancedDataUrl = canvas.toDataURL(mimeType, quality);
  
  // Only embed EXIF for JPEG
  if (imageFormat === 'jpeg') {
    const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
    enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  }
  
  return enhancedDataUrl;
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
  if (file.type === 'image/png') {
    return 'png';
  }
  return 'jpeg';
}

export function detectFormatFromDataUrl(dataUrl: string): ImageFormat {
  if (dataUrl.startsWith('data:image/png')) {
    return 'png';
  }
  return 'jpeg';
}

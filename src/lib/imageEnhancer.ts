import { FilterType, RawExifData } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { embedExifIntoJpeg, CameraExifData, generateDefaultCameraExif } from './exifWriter';
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

export async function enhanceImageWithAI(
  imageDataUrl: string,
  filters: FilterType[],
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number,
  customApiKeys?: string[]
): Promise<string> {
  // Calculate target dimensions (at least 5MP)
  const { targetWidth, targetHeight } = calculateMinimumDimensions(originalWidth, originalHeight);
  
  const { data, error } = await supabase.functions.invoke('enhance-image', {
    body: { 
      imageBase64: imageDataUrl, 
      filters,
      customApiKeys
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
  
  // Resize to target dimensions (at least 5MP)
  enhancedDataUrl = await resizeToTarget(enhancedDataUrl, targetWidth, targetHeight);
  
  // Embed EXIF data
  const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
  enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  
  return enhancedDataUrl;
}

// Resize image to target dimensions
async function resizeToTarget(dataUrl: string, targetWidth: number, targetHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } else {
        reject(new Error('Failed to get canvas context'));
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Embed IPTC/XMP metadata for microstock compatibility
export function embedIptcXmpMetadata(
  dataUrl: string, 
  title: string, 
  description: string, 
  keywords: string
): string {
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
  originalHeight: number
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
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Combine settings from all selected filters
        const combinedSettings = getCombinedFilterSettings(filters);
        
        for (let i = 0; i < data.length; i += 4) {
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
          
          // Sharpening is simulated via contrast boost (already applied above)
        }
        
        ctx.putImageData(imageData, 0, 0);
      }
      resolve();
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  let enhancedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const completeRawExif = generateRawExif(rawExif, targetWidth, targetHeight);
  enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  
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

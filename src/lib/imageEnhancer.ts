import { FilterType, RawExifData } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { embedExifIntoJpeg } from './exifWriter';
import { generateRawExif } from './exif';

export async function enhanceImageWithAI(
  imageDataUrl: string,
  filter: FilterType,
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('enhance-image', {
    body: { imageBase64: imageDataUrl, filter }
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new Error(error.message || 'Failed to enhance image');
  }

  if (data.error) {
    throw new Error(data.error);
  }

  let enhancedDataUrl = data.enhancedImage;
  
  // Resize back to original dimensions to preserve size
  enhancedDataUrl = await resizeToOriginal(enhancedDataUrl, originalWidth, originalHeight);
  
  // Generate complete EXIF data using original extracted data and embed into enhanced image
  const completeRawExif = generateRawExif(rawExif, originalWidth, originalHeight);
  enhancedDataUrl = embedExifIntoJpeg(enhancedDataUrl, completeRawExif);
  
  return enhancedDataUrl;
}

// Resize image back to original dimensions
async function resizeToOriginal(dataUrl: string, targetWidth: number, targetHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
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

// Fallback local enhancement for when AI is unavailable
export async function enhanceImageLocally(
  imageDataUrl: string,
  filter: FilterType,
  rawExif: RawExifData,
  originalWidth: number,
  originalHeight: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      // Use original dimensions, not the image's current dimensions
      canvas.width = originalWidth;
      canvas.height = originalHeight;
      
      if (ctx) {
        ctx.drawImage(img, 0, 0, originalWidth, originalHeight);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Apply filter-specific enhancements
        const settings = getFilterSettings(filter);
        
        for (let i = 0; i < data.length; i += 4) {
          // Contrast adjustment
          data[i] = Math.min(255, Math.max(0, settings.contrast * (data[i] - 128) + 128));
          data[i + 1] = Math.min(255, Math.max(0, settings.contrast * (data[i + 1] - 128) + 128));
          data[i + 2] = Math.min(255, Math.max(0, settings.contrast * (data[i + 2] - 128) + 128));
          
          // Saturation adjustment
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          data[i] = Math.min(255, Math.max(0, avg + settings.saturation * (data[i] - avg)));
          data[i + 1] = Math.min(255, Math.max(0, avg + settings.saturation * (data[i + 1] - avg)));
          data[i + 2] = Math.min(255, Math.max(0, avg + settings.saturation * (data[i + 2] - avg)));
          
          // Color tinting for cinematic
          if (filter === 'cinematic') {
            data[i] = Math.min(255, data[i] * 1.05); // Slight orange in highlights
            data[i + 2] = Math.min(255, data[i + 2] * 1.08); // Slight teal in shadows
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
      }
      resolve();
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  let enhancedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const completeRawExif = generateRawExif(rawExif, originalWidth, originalHeight);
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
    default:
      return { contrast: 1.15, saturation: 1.2 };
  }
}

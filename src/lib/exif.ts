import ExifReader from 'exifreader';
import { ExifData, RawExifData } from '@/types/photo';

export async function extractExif(file: File): Promise<{ display: ExifData; raw: RawExifData }> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const tags = ExifReader.load(arrayBuffer, { expanded: true });
    
    const display: ExifData = {};
    const raw: RawExifData = {};
    
    // Basic image info
    if (tags.exif) {
      display.make = tags.exif.Make?.description;
      display.model = tags.exif.Model?.description;
      display.dateTime = tags.exif.DateTimeOriginal?.description || tags.exif.DateTime?.description;
      display.exposureTime = tags.exif.ExposureTime?.description;
      display.fNumber = tags.exif.FNumber?.description;
      display.iso = tags.exif.ISOSpeedRatings?.value as number;
      display.focalLength = tags.exif.FocalLength?.description;
      display.software = tags.exif.Software?.description;
      display.orientation = tags.exif.Orientation?.value as number;
      display.colorSpace = tags.exif.ColorSpace?.description;
      display.flash = tags.exif.Flash?.description;
      display.whiteBalance = tags.exif.WhiteBalance?.description;

      // Raw numeric values for embedding
      raw.make = tags.exif.Make?.description;
      raw.model = tags.exif.Model?.description;
      raw.dateTime = tags.exif.DateTimeOriginal?.description || tags.exif.DateTime?.description;
      raw.iso = tags.exif.ISOSpeedRatings?.value as number;
      raw.orientation = tags.exif.Orientation?.value as number;
      raw.software = tags.exif.Software?.description;
      
      // Parse exposure time (e.g., "1/125" -> 0.008)
      if (tags.exif.ExposureTime?.value) {
        const expVal = tags.exif.ExposureTime.value;
        if (Array.isArray(expVal) && expVal.length === 2) {
          raw.exposureTime = expVal[0] / expVal[1];
        }
      }
      
      // Parse f-number
      if (tags.exif.FNumber?.value) {
        const fVal = tags.exif.FNumber.value;
        if (Array.isArray(fVal) && fVal.length === 2) {
          raw.fNumber = fVal[0] / fVal[1];
        }
      }
      
      // Parse focal length
      if (tags.exif.FocalLength?.value) {
        const flVal = tags.exif.FocalLength.value;
        if (Array.isArray(flVal) && flVal.length === 2) {
          raw.focalLength = flVal[0] / flVal[1];
        }
      }
      
      raw.colorSpace = tags.exif.ColorSpace?.value as number;
      raw.flash = tags.exif.Flash?.value as number;
      raw.whiteBalance = tags.exif.WhiteBalance?.value as number;
    }
    
    // Image dimensions
    if (tags.file) {
      display.width = tags.file['Image Width']?.value as number;
      display.height = tags.file['Image Height']?.value as number;
      raw.width = tags.file['Image Width']?.value as number;
      raw.height = tags.file['Image Height']?.value as number;
    }
    
    // GPS data
    if (tags.gps) {
      display.gpsLatitude = tags.gps.Latitude;
      display.gpsLongitude = tags.gps.Longitude;
    }
    
    return { display, raw };
  } catch (error) {
    console.error('Error extracting EXIF:', error);
    return { display: {}, raw: {} };
  }
}

export function generateAiExif(existingExif: ExifData): ExifData {
  const enhanced: ExifData = { ...existingExif };
  
  // Always set software to Photoshop for microstock compatibility
  enhanced.software = 'Adobe Photoshop CS6 (Windows)';
  
  if (!enhanced.dateTime) {
    enhanced.dateTime = new Date().toISOString().split('T')[0].replace(/-/g, ':') + ' 12:00:00';
  }
  
  if (!enhanced.colorSpace) {
    enhanced.colorSpace = 'sRGB';
  }
  
  return enhanced;
}

export function generateRawExif(existingRaw: RawExifData, width?: number, height?: number): RawExifData {
  const enhanced: RawExifData = { ...existingRaw };
  
  // Always set software to Photoshop for microstock compatibility
  enhanced.software = 'Adobe Photoshop CS6 (Windows)';
  
  // Set dimensions if provided (use original image dimensions)
  if (width) enhanced.width = width;
  if (height) enhanced.height = height;
  
  // Only set defaults for truly missing required fields
  if (!enhanced.colorSpace) {
    enhanced.colorSpace = 1; // sRGB
  }
  if (!enhanced.orientation) {
    enhanced.orientation = 1;
  }
  
  return enhanced;
}

export function formatExifValue(key: string, value: string | number | undefined): string {
  if (value === undefined || value === null) return 'N/A';
  
  switch (key) {
    case 'exposureTime':
      return `${value}s`;
    case 'fNumber':
      return `f/${value}`;
    case 'iso':
      return `ISO ${value}`;
    case 'focalLength':
      return `${value}`;
    case 'gpsLatitude':
    case 'gpsLongitude':
      return typeof value === 'number' ? value.toFixed(6) + '°' : String(value);
    default:
      return String(value);
  }
}

export const exifLabels: Record<string, string> = {
  make: 'Camera Make',
  model: 'Camera Model',
  dateTime: 'Date Taken',
  exposureTime: 'Exposure',
  fNumber: 'Aperture',
  iso: 'ISO',
  focalLength: 'Focal Length',
  software: 'Software',
  orientation: 'Orientation',
  width: 'Width',
  height: 'Height',
  colorSpace: 'Color Space',
  flash: 'Flash',
  whiteBalance: 'White Balance',
  gpsLatitude: 'GPS Latitude',
  gpsLongitude: 'GPS Longitude',
};

// Convert file to data URL with validation
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || file.size === 0) {
      reject(new Error('Invalid or empty file'));
      return;
    }
    
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Validate the result is a proper data URL
      if (!result || !result.startsWith('data:image/') || result.length < 100) {
        reject(new Error('File conversion produced invalid data URL'));
        return;
      }
      console.log(`Converted ${file.name} to data URL (${result.length} chars, format: ${result.substring(0, 30)}...)`);
      resolve(result);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

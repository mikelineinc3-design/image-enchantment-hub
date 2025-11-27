import ExifReader from 'exifreader';
import { ExifData } from '@/types/photo';

export async function extractExif(file: File): Promise<ExifData> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const tags = ExifReader.load(arrayBuffer, { expanded: true });
    
    const exif: ExifData = {};
    
    // Basic image info
    if (tags.exif) {
      exif.make = tags.exif.Make?.description;
      exif.model = tags.exif.Model?.description;
      exif.dateTime = tags.exif.DateTimeOriginal?.description || tags.exif.DateTime?.description;
      exif.exposureTime = tags.exif.ExposureTime?.description;
      exif.fNumber = tags.exif.FNumber?.description;
      exif.iso = tags.exif.ISOSpeedRatings?.value as number;
      exif.focalLength = tags.exif.FocalLength?.description;
      exif.software = tags.exif.Software?.description;
      exif.orientation = tags.exif.Orientation?.value as number;
      exif.colorSpace = tags.exif.ColorSpace?.description;
      exif.flash = tags.exif.Flash?.description;
      exif.whiteBalance = tags.exif.WhiteBalance?.description;
    }
    
    // Image dimensions
    if (tags.file) {
      exif.width = tags.file['Image Width']?.value as number;
      exif.height = tags.file['Image Height']?.value as number;
    }
    
    // GPS data
    if (tags.gps) {
      exif.gpsLatitude = tags.gps.Latitude;
      exif.gpsLongitude = tags.gps.Longitude;
    }
    
    return exif;
  } catch (error) {
    console.error('Error extracting EXIF:', error);
    return {};
  }
}

export function generateAiExif(existingExif: ExifData): ExifData {
  const enhanced: ExifData = { ...existingExif };
  
  // Generate missing metadata with reasonable defaults
  if (!enhanced.software) {
    enhanced.software = 'PhotoMaster AI Enhanced';
  }
  
  if (!enhanced.dateTime) {
    enhanced.dateTime = new Date().toISOString().split('T')[0].replace(/-/g, ':') + ' 12:00:00';
  }
  
  if (!enhanced.colorSpace) {
    enhanced.colorSpace = 'sRGB';
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

import piexif from 'piexifjs';

export interface CameraExifData {
  make?: string;
  model?: string;
  dateTime?: string;
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  software?: string;
  orientation?: number;
  width?: number;
  height?: number;
  colorSpace?: number;
  flash?: number;
  whiteBalance?: number;
}

// Convert rational number format for EXIF
function toRational(value: number): [number, number] {
  const denominator = 1000000;
  return [Math.round(value * denominator), denominator];
}

// Generate default camera EXIF data if none exists
export function generateDefaultCameraExif(): CameraExifData {
  return {
    make: 'Digital Camera',
    model: 'Professional DSLR',
    dateTime: new Date().toISOString().replace('T', ' ').split('.')[0],
    exposureTime: 1/125,
    fNumber: 5.6,
    iso: 200,
    focalLength: 50,
    software: 'PhotoMaster AI Enhanced',
    orientation: 1,
    colorSpace: 1, // sRGB
    flash: 0,
    whiteBalance: 0, // Auto
  };
}

export function embedExifIntoJpeg(
  jpegDataUrl: string, 
  exifData: CameraExifData
): string {
  try {
    // Remove data URL prefix to get base64
    const base64Data = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '');
    
    // Try to load existing EXIF, or create new
    let exifObj: any;
    try {
      exifObj = piexif.load(jpegDataUrl);
    } catch {
      exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'thumbnail': null };
    }

    // Ensure all sections exist
    exifObj['0th'] = exifObj['0th'] || {};
    exifObj['Exif'] = exifObj['Exif'] || {};

    // Set 0th IFD (main image info)
    if (exifData.make) {
      exifObj['0th'][piexif.ImageIFD.Make] = exifData.make;
    }
    if (exifData.model) {
      exifObj['0th'][piexif.ImageIFD.Model] = exifData.model;
    }
    if (exifData.orientation) {
      exifObj['0th'][piexif.ImageIFD.Orientation] = exifData.orientation;
    }
    if (exifData.software) {
      exifObj['0th'][piexif.ImageIFD.Software] = exifData.software;
    }
    if (exifData.dateTime) {
      exifObj['0th'][piexif.ImageIFD.DateTime] = exifData.dateTime;
    }

    // Set Exif IFD (camera settings)
    if (exifData.dateTime) {
      exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = exifData.dateTime;
      exifObj['Exif'][piexif.ExifIFD.DateTimeDigitized] = exifData.dateTime;
    }
    if (exifData.exposureTime !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.ExposureTime] = toRational(exifData.exposureTime);
    }
    if (exifData.fNumber !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.FNumber] = toRational(exifData.fNumber);
    }
    if (exifData.iso !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.ISOSpeedRatings] = exifData.iso;
    }
    if (exifData.focalLength !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.FocalLength] = toRational(exifData.focalLength);
    }
    if (exifData.colorSpace !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.ColorSpace] = exifData.colorSpace;
    }
    if (exifData.flash !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.Flash] = exifData.flash;
    }
    if (exifData.whiteBalance !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.WhiteBalance] = exifData.whiteBalance;
    }
    if (exifData.width !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.PixelXDimension] = exifData.width;
    }
    if (exifData.height !== undefined) {
      exifObj['Exif'][piexif.ExifIFD.PixelYDimension] = exifData.height;
    }

    // Generate EXIF bytes and insert
    const exifBytes = piexif.dump(exifObj);
    const newJpegDataUrl = piexif.insert(exifBytes, jpegDataUrl);
    
    return newJpegDataUrl;
  } catch (error) {
    console.error('Error embedding EXIF:', error);
    return jpegDataUrl; // Return original if failed
  }
}

// Extract raw EXIF bytes from original image to preserve them
export function extractExifBytes(jpegDataUrl: string): string | null {
  try {
    const exifObj = piexif.load(jpegDataUrl);
    return piexif.dump(exifObj);
  } catch {
    return null;
  }
}

// Transfer EXIF from original to new image
export function transferExif(originalDataUrl: string, newDataUrl: string): string {
  try {
    const exifBytes = extractExifBytes(originalDataUrl);
    if (exifBytes) {
      return piexif.insert(exifBytes, newDataUrl);
    }
    return newDataUrl;
  } catch (error) {
    console.error('Error transferring EXIF:', error);
    return newDataUrl;
  }
}

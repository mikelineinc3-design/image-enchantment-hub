export interface ExifData {
  make?: string;
  model?: string;
  dateTime?: string;
  exposureTime?: string;
  fNumber?: string;
  iso?: number;
  focalLength?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  software?: string;
  orientation?: number;
  width?: number;
  height?: number;
  colorSpace?: string;
  flash?: string;
  whiteBalance?: string;
  [key: string]: string | number | undefined;
}

export interface PhotoFile {
  id: string;
  file: File;
  preview: string;
  originalExif: ExifData;
  enhancedExif: ExifData;
  enhancedPreview?: string;
  status: 'uploaded' | 'extracting' | 'enhancing' | 'ready' | 'error';
  error?: string;
}

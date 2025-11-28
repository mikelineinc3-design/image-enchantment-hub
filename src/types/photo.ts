export type FilterType = 'default' | 'vibrant' | 'cinematic' | 'natural';
export type FileType = 'jpg' | 'png' | 'eps' | 'svg';

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

export interface RawExifData {
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

export interface MicrostockMetadata {
  filename: string;
  title: string;
  keywords: string;
  adobeCategory: string;
  shutterstockCategory: string;
}

export interface PhotoFile {
  id: string;
  file: File;
  preview: string;
  originalDataUrl: string;
  originalExif: ExifData;
  rawExif: RawExifData;
  enhancedExif: ExifData;
  enhancedPreview?: string;
  status: 'uploaded' | 'extracting' | 'enhancing' | 'generating-metadata' | 'ready' | 'error';
  error?: string;
  selectedFilter: FilterType;
  fileType: FileType;
  metadata?: MicrostockMetadata;
}

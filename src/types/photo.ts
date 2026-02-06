export type FilterType = 'default' | 'vibrant' | 'cinematic' | 'natural' | 'product' | 'sharpener' | 'hdr';
export type FileType = 'jpg' | 'png' | 'eps' | 'svg';
export type ImageFormat = 'jpeg' | 'png';

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
  description: string;
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
  selectedFilters: FilterType[];
  fileType: FileType;
  metadata?: MicrostockMetadata;
  imageFormat: ImageFormat; // Track original format (jpeg or png)
}

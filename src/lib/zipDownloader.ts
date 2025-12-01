import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { PhotoFile } from '@/types/photo';
import { generateMetadataCSV } from './csvExporter';

function dataUrlToBlob(dataUrl: string): Blob {
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

export async function downloadAllAsZip(photos: PhotoFile[]): Promise<void> {
  const readyPhotos = photos.filter(p => p.status === 'ready' && p.enhancedPreview);
  
  if (readyPhotos.length === 0) {
    throw new Error('No enhanced photos to download');
  }

  const zip = new JSZip();
  const imagesFolder = zip.folder('images');

  for (const photo of readyPhotos) {
    if (!photo.enhancedPreview) continue;

    // Get original file extension
    const originalExt = photo.file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const baseName = photo.metadata?.filename.replace(/\.[^/.]+$/, '') || 
      photo.file.name.replace(/\.[^/.]+$/, '') + '_enhanced';
    const filename = `${baseName}.${originalExt}`;

    const blob = dataUrlToBlob(photo.enhancedPreview);
    imagesFolder?.file(filename, blob);
  }

  // Add CSV with metadata
  const csv = generateMetadataCSV(readyPhotos);
  zip.file('metadata.csv', csv);

  // Generate and download ZIP
  const content = await zip.generateAsync({ type: 'blob' });
  const timestamp = new Date().toISOString().split('T')[0];
  saveAs(content, `enhanced_photos_${timestamp}.zip`);
}

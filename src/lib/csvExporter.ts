import { PhotoFile } from '@/types/photo';

interface CsvRow {
  filename: string;
  title: string;
  description: string;
  keywords: string;
  category: string;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateMetadataCSV(photos: PhotoFile[]): string {
  const headers = ['filename', 'title', 'description', 'keywords', 'category'];
  const rows: string[] = [headers.join(',')];

  for (const photo of photos) {
    if (!photo.metadata) continue;

    // Get original file extension
    const originalExt = photo.file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const baseName = photo.metadata.filename.replace(/\.[^/.]+$/, '');
    const filename = `${baseName}.${originalExt}`;

    const row: CsvRow = {
      filename,
      title: photo.metadata.title,
      description: photo.metadata.title, // Using title as description
      keywords: photo.metadata.keywords,
      category: `Adobe: ${photo.metadata.adobeCategory} | Shutterstock: ${photo.metadata.shutterstockCategory}`
    };

    rows.push([
      escapeCSV(row.filename),
      escapeCSV(row.title),
      escapeCSV(row.description),
      escapeCSV(row.keywords),
      escapeCSV(row.category)
    ].join(','));
  }

  return rows.join('\n');
}

export function downloadCSV(photos: PhotoFile[]): void {
  const csv = generateMetadataCSV(photos);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `microstock_metadata_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

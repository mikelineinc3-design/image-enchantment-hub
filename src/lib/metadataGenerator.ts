import { FileType, MicrostockMetadata } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';

export async function generateMicrostockMetadata(
  imageDataUrl: string,
  fileType: FileType
): Promise<MicrostockMetadata> {
  const { data, error } = await supabase.functions.invoke('generate-metadata', {
    body: { imageBase64: imageDataUrl, fileType }
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new Error(error.message || 'Failed to generate metadata');
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    filename: data.filename || '',
    title: data.title || '',
    keywords: data.keywords || '',
    adobeCategory: data.adobeCategory || '',
    shutterstockCategory: data.shutterstockCategory || ''
  };
}

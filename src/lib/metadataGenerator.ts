import { FileType, MicrostockMetadata } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeTitle, sanitizeKeywords } from './iptcXmpWriter';

export async function generateMicrostockMetadata(
  imageDataUrl: string,
  fileType: FileType,
  customApiKeys?: string[]
): Promise<MicrostockMetadata> {
  const { data, error } = await supabase.functions.invoke('generate-metadata', {
    body: { imageBase64: imageDataUrl, fileType, customApiKeys }
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new Error(error.message || 'Failed to generate metadata');
  }

  if (data.error) {
    throw new Error(data.error);
  }

  // Sanitize title (max 195 chars, no special characters)
  const sanitizedTitle = sanitizeTitle(data.title || '');
  
  // Sanitize keywords (max 45)
  const sanitizedKeywords = sanitizeKeywords(data.keywords || '').join(', ');

  return {
    filename: data.filename || '',
    title: sanitizedTitle,
    description: sanitizedTitle, // Use title as description
    keywords: sanitizedKeywords,
    adobeCategory: data.adobeCategory || '',
    shutterstockCategory: data.shutterstockCategory || ''
  };
}

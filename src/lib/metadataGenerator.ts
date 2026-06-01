import { FileType, MicrostockMetadata, MetadataMode } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeTitle, sanitizeKeywords } from './iptcXmpWriter';

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateMicrostockMetadata(
  imageDataUrl: string,
  fileType: FileType,
  customApiKeys?: string[],
  mode: MetadataMode = 'default',
  customPrompt?: string
): Promise<MicrostockMetadata> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('generate-metadata', {
        body: { imageBase64: imageDataUrl, fileType, customApiKeys, mode, customPrompt }
      });

      if (error) {
        console.error(`Edge function error (attempt ${attempt}/${MAX_RETRIES}):`, error);
        lastError = new Error(error.message || 'Failed to generate metadata');
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY * attempt); continue; }
        throw lastError;
      }

      if (data.error) {
        lastError = new Error(data.error);
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY * attempt); continue; }
        throw lastError;
      }

      const sanitizedTitle = sanitizeTitle(data.title || '');
      const sanitizedKeywords = sanitizeKeywords(data.keywords || '').join(', ');

      return {
        filename: data.filename || '',
        title: sanitizedTitle,
        description: sanitizedTitle,
        keywords: sanitizedKeywords,
        adobeCategory: data.adobeCategory || '',
        shutterstockCategory: data.shutterstockCategory || '',
        aiTrainingNote: data.aiTrainingNote || undefined,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Metadata generation attempt ${attempt}/${MAX_RETRIES} failed:`, err);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY * attempt);
    }
  }
  
  throw lastError || new Error('Failed to generate metadata after multiple attempts');
}

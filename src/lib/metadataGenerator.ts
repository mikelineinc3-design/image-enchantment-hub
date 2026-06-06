import { FileType, MicrostockMetadata, MetadataMode } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeTitle, sanitizeKeywords } from './iptcXmpWriter';

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const NON_RETRYABLE_ERROR_CODES = new Set(['payment_required', 'invalid_api_key']);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readFunctionError(error: unknown): Promise<{ message: string; code?: string }> {
  const fallback = error instanceof Error ? error.message : 'Failed to generate metadata';
  const response = (error as { context?: Response })?.context;

  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (payload && typeof payload.error === 'string') {
        return {
          message: payload.error,
          code: typeof payload.code === 'string' ? payload.code : undefined,
        };
      }
    } catch {
      // Fall back to the SDK error message when the response body is not JSON.
    }
  }

  return { message: fallback };
}

export async function generateMicrostockMetadata(
  imageDataUrl: string,
  fileType: FileType,
  customApiKeys?: string[],
  mode: MetadataMode = 'default',
  customPrompt?: string,
  groqApiKeys?: string[],
  geminiApiKeys?: string[]
): Promise<MicrostockMetadata> {
  let lastError: Error | null = null;
  let lastErrorCode: string | undefined;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('generate-metadata', {
        body: { imageBase64: imageDataUrl, fileType, customApiKeys, mode, customPrompt, groqApiKeys, geminiApiKeys }
      });

      if (error) {
        console.error(`Edge function error (attempt ${attempt}/${MAX_RETRIES}):`, error);
        const parsedError = await readFunctionError(error);
        lastErrorCode = parsedError.code;
        lastError = new Error(parsedError.message);
        if (lastErrorCode && NON_RETRYABLE_ERROR_CODES.has(lastErrorCode)) throw lastError;
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY * attempt); continue; }
        throw lastError;
      }

      if (data.error) {
        lastErrorCode = typeof data.code === 'string' ? data.code : undefined;
        lastError = new Error(data.error);
        if (lastErrorCode && NON_RETRYABLE_ERROR_CODES.has(lastErrorCode)) throw lastError;
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
      if (lastErrorCode && NON_RETRYABLE_ERROR_CODES.has(lastErrorCode)) break;
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY * attempt);
    }
  }
  
  throw lastError || new Error('Failed to generate metadata after multiple attempts');
}

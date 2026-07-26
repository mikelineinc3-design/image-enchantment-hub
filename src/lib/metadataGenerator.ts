import { FileType, MicrostockMetadata, MetadataMode } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeTitle, sanitizeKeywords } from './iptcXmpWriter';

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const NON_RETRYABLE_ERROR_CODES = new Set(['payment_required', 'invalid_api_key']);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Downscale a raster data URL so the longest edge is <= maxLongEdge px.
 * Returns a JPEG data URL. If the source is already small enough, returns it unchanged.
 * Used ONLY for the AI vision request payload — never for the exported file.
 */
export async function createVisionPreview(
  dataUrl: string,
  maxLongEdge = 1568,
  quality = 0.85
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('vision preview image load failed'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;
    const longest = Math.max(w, h);
    if (longest <= maxLongEdge) return dataUrl;
    const scale = maxLongEdge / longest;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);
    const out = canvas.toDataURL('image/jpeg', quality);
    console.log('[visionPreview] resized', { from: `${w}x${h}`, to: `${tw}x${th}`, bytes: out.length });
    return out;
  } catch (err) {
    console.warn('[visionPreview] failed, using original', err);
    return dataUrl;
  }
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
  geminiApiKeys?: string[],
  fpMode = false,
  agentrouterApiKeys?: string[],
  openrouterApiKeys?: string[]
): Promise<MicrostockMetadata> {
  let lastError: Error | null = null;
  let lastErrorCode: string | undefined;

  // Vector native payloads (raw EPS/SVG text-as-dataURL) must NOT be rasterized here.
  // For raster images, downscale a copy for the AI request only — the exported file is untouched.
  const isVectorPayload = fileType === 'eps' || fileType === 'svg';
  const isRasterDataUrl = imageDataUrl.startsWith('data:image/') &&
    !imageDataUrl.startsWith('data:image/svg');
  const visionPayload = (!isVectorPayload && isRasterDataUrl)
    ? await createVisionPreview(imageDataUrl)
    : imageDataUrl;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('[metadataGenerator] invoke', {
        fileType,
        mode,
        openaiKeys: customApiKeys?.length || 0,
        groqKeys: groqApiKeys?.length || 0,
        geminiKeys: geminiApiKeys?.length || 0,
        agentrouterKeys: agentrouterApiKeys?.length || 0,
        openrouterKeys: openrouterApiKeys?.length || 0,
        imageBase64Prefix: visionPayload.slice(0, 40),
        payloadBytes: visionPayload.length,
      });
      const { data, error } = await supabase.functions.invoke('generate-metadata', {
        body: { imageBase64: visionPayload, fileType, customApiKeys, mode, customPrompt, groqApiKeys, geminiApiKeys, fpMode, agentrouterApiKeys, openrouterApiKeys }
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

      const sanitizedTitle = sanitizeTitle(data.title || '', fpMode ? 99 : 200);
      const sanitizedKeywords = sanitizeKeywords(data.keywords || '', fpMode ? 48 : 49).join(', ');

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

import { FileType, MicrostockMetadata, MetadataMode } from '@/types/photo';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeTitle, sanitizeKeywords } from './iptcXmpWriter';
import { runGeminiThrottled } from './geminiRateLimiter';

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

// Gemini's free tier applies stricter (often zero) quota to requests coming
// from cloud/datacenter IPs (e.g. Supabase Edge Functions run on Deno
// Deploy) even when the same key works fine from a normal browser/residential
// connection — this is a documented Google-side restriction, not a bug in
// our code. So for Gemini specifically, call it DIRECTLY FROM THE BROWSER
// (this function), using the person's own network connection, instead of
// proxying through the edge function.
function buildMetadataPrompt(fileType: FileType, mode: MetadataMode, customPrompt: string | undefined, fpMode: boolean) {
  const isVector = fileType === 'eps' || fileType === 'svg';
  const assetFormatLabel = isVector ? 'VECTOR (EPS/SVG)' : `RASTER PHOTO (${fileType.toUpperCase()})`;
  const vectorRule = isVector
    ? "Include vector-specific keywords (vector, eps, illustration, clipart, graphic design) where they genuinely fit."
    : "STRICTLY DO NOT include 'vector', 'eps', 'illustration', or 'clipart' keywords — this is a raster photograph.";
  const titleLimit = fpMode ? 99 : 200;
  const titleMin = fpMode ? 50 : 100;
  const keywordsLimit = fpMode ? 48 : 49;

  let prompt = `You are an automated microstock metadata engine for Adobe Stock and Shutterstock. Output ONLY a single strict JSON object — no prose, no greetings, no markdown, no code fences.

ACTIVE ASSET FORMAT: ${assetFormatLabel}
${vectorRule}

GENERATE THESE FIELDS:
1. TITLE: exactly between ${titleMin} and ${titleLimit} characters, literal description first, then embed long-tail keywords.
2. SUGGESTED FILENAME: lowercase hyphen-separated, ending in .${fileType}.
3. KEYWORDS: exactly ${keywordsLimit} or fewer, all lowercase, ~70% single-word / 30% two-word phrases, highest-demand terms first, no duplicates. ${vectorRule}
4. adobeCategory and shutterstockCategory: one official category name each.
5. Always include: copyright: "Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.", rights: "Microstock Commercial License", author: "Microstock Contributor".

Return ONLY this JSON object:
{"filename":"...","title":"...","keywords":"...","adobeCategory":"...","shutterstockCategory":"...","copyright":"Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.","rights":"Microstock Commercial License","author":"Microstock Contributor"}`;

  if (mode === 'data') {
    prompt += `\n\nAlso include "aiTrainingNote" (<=500 chars) describing what AI models could learn from this image. Append it to the JSON above.`;
  }
  if (customPrompt && customPrompt.trim()) {
    prompt += `\n\nADDITIONAL USER INSTRUCTIONS (apply to title and keywords):\n${customPrompt.trim()}`;
  }
  const userText = isVector
    ? `Generate microstock metadata for a VECTOR ${fileType.toUpperCase()} asset. Respond with the required JSON only.`
    : 'Analyze the attached image and respond with the required JSON only.';
  return { systemPrompt: prompt, userText, isVector };
}

async function tryGeminiClientSide(
  visionPayload: string,
  fileType: FileType,
  mode: MetadataMode,
  customPrompt: string | undefined,
  fpMode: boolean,
  apiKey: string
): Promise<MicrostockMetadata | null> {
  const { systemPrompt, userText, isVector } = buildMetadataPrompt(fileType, mode, customPrompt, fpMode);
  const base64Match = visionPayload.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  const mimeType = base64Match?.[1] || 'image/jpeg';
  const rawBase64 = base64Match?.[2] || visionPayload.split(',').pop() || '';

  const parts: Array<Record<string, unknown>> = [{ text: `${systemPrompt}\n\n${userText}` }];
  if (!isVector) parts.push({ inline_data: { mime_type: mimeType, data: rawBase64 } });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { response_mime_type: 'application/json', maxOutputTokens: 1500 }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.warn('[gemini-client] request failed', response.status, errText.slice(0, 200));
    return null;
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const sanitizedTitle = sanitizeTitle(String(metadata.title || ''), fpMode ? 99 : 200);
  const sanitizedKeywords = sanitizeKeywords(String(metadata.keywords || ''), fpMode ? 48 : 49).join(', ');
  return {
    filename: String(metadata.filename || `image.${fileType}`),
    title: sanitizedTitle,
    description: sanitizedTitle,
    keywords: sanitizedKeywords,
    adobeCategory: String(metadata.adobeCategory || 'Lifestyle'),
    shutterstockCategory: String(metadata.shutterstockCategory || 'Miscellaneous'),
    aiTrainingNote: typeof metadata.aiTrainingNote === 'string' ? metadata.aiTrainingNote.slice(0, 1000) : undefined,
  };
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

  // Try Gemini directly from the browser first — see tryGeminiClientSide for why.
  if (geminiApiKeys && geminiApiKeys.length > 0) {
    for (const key of geminiApiKeys) {
      try {
        const result = await runGeminiThrottled(() =>
          tryGeminiClientSide(visionPayload, fileType, mode, customPrompt, fpMode, key)
        );
        if (result) {
          console.log('[metadataGenerator] Gemini (client-side) succeeded');
          return result;
        }
      } catch (e) {
        console.warn('[gemini-client] key failed, trying next:', e);
      }
    }
    console.log('[metadataGenerator] All client-side Gemini keys failed, falling back to edge function providers');
  }

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
        body: { imageBase64: visionPayload, fileType, customApiKeys, mode, customPrompt, groqApiKeys, fpMode, agentrouterApiKeys, openrouterApiKeys }
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

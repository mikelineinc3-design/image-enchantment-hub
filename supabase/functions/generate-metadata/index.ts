import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FILE_TYPES = ['jpg', 'png', 'eps', 'svg'];
const MAX_BASE64_SIZE = 20 * 1024 * 1024;

interface ApiKeyEntry {
  key: string;
  type: 'lovable' | 'openai' | 'groq' | 'gemini' | 'agentrouter';
}

interface ProviderFailure {
  provider: ApiKeyEntry['type'];
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType = 'jpg', customApiKeys, mode = 'default', customPrompt, groqApiKeys, geminiApiKeys, fpMode = false, agentrouterApiKeys } = await req.json();
    
    // Input validation
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid image data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (imageBase64.length > MAX_BASE64_SIZE) {
      return new Response(JSON.stringify({ error: 'Image too large' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Validate base64 format - must be a valid data URL.
    // Vector assets (EPS/SVG) may arrive as their native MIME (text-only path)
    // OR as a rasterized PNG preview (vision path — describes the actual artwork).
    const rasterDataUrlMatch = imageBase64.match(/^data:image\/(jpeg|jpg|png|gif|webp|x-png);base64,/i);
    const isVectorPayload =
      !rasterDataUrlMatch &&
      (imageBase64.startsWith('data:application/postscript') ||
        imageBase64.startsWith('data:image/svg+xml') ||
        fileType === 'eps' || fileType === 'svg');

    if (!rasterDataUrlMatch && !isVectorPayload) {
      const hasBase64Content = imageBase64.length > 100 && imageBase64.includes(',');
      if (!hasBase64Content) {
        console.error('Invalid image data URL format:', imageBase64.substring(0, 100));
        return new Response(JSON.stringify({ error: 'Invalid image format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.log('Non-standard data URL format, attempting to use anyway');
    }

    const safeFileType = ALLOWED_FILE_TYPES.includes(fileType) ? fileType : 'jpg';

    
    // Collect API keys with their types — UNIFIED ROTATION POOL.
    // User-provided keys are tried first (any provider), then Lovable as last fallback.
    const apiKeys: ApiKeyEntry[] = [];
    // Relaxed validation: providers issue keys of varying length and character sets.
    // OpenAI project keys (sk-proj-...) can exceed 200 chars and include extra chars.
    const isValidKey = (k: unknown): k is string =>
      typeof k === 'string' && k.trim().length >= 20 && k.trim().length <= 500;

    // Gemini direct keys (Google AI Studio) — vision-capable
    if (geminiApiKeys && Array.isArray(geminiApiKeys)) {
      for (const k of geminiApiKeys) if (isValidKey(k)) apiKeys.push({ key: k.trim(), type: 'gemini' });
    }
    // OpenAI keys — vision-capable (gpt-4o-mini)
    if (customApiKeys && Array.isArray(customApiKeys)) {
      for (const k of customApiKeys) if (isValidKey(k)) apiKeys.push({ key: k.trim(), type: 'openai' });
    }
    // Groq keys — vision-capable model used below
    if (groqApiKeys && Array.isArray(groqApiKeys)) {
      for (const k of groqApiKeys) if (isValidKey(k)) apiKeys.push({ key: k.trim(), type: 'groq' });
    }
    // AgentRouter keys — OpenAI-compatible, vision-capable fallback
    if (agentrouterApiKeys && Array.isArray(agentrouterApiKeys)) {
      for (const k of agentrouterApiKeys) if (isValidKey(k)) apiKeys.push({ key: k.trim(), type: 'agentrouter' });
    }

    // Lovable AI Gateway as final fallback
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      apiKeys.push({ key: LOVABLE_API_KEY, type: 'lovable' });

    }
    
    if (apiKeys.length === 0) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const isVector = safeFileType === 'eps' || safeFileType === 'svg';
    const assetFormatLabel = isVector ? 'VECTOR (EPS/SVG)' : `RASTER PHOTO (${safeFileType.toUpperCase()})`;
    const vectorRule = isVector
      ? "Include vector-specific keywords (vector, eps, illustration, clipart, graphic design) where they genuinely fit."
      : "STRICTLY DO NOT include 'vector', 'eps', 'illustration', or 'clipart' keywords — this is a raster photograph.";

    const titleLimit = fpMode ? 99 : 200;
    const titleMin = fpMode ? 50 : 100;
    const keywordsLimit = fpMode ? 48 : 49;

    const masterSystemPrompt = `You are an automated microstock metadata engine for Adobe Stock and Shutterstock. Output ONLY a single strict JSON object — no prose, no greetings, no markdown, no code fences.

ACTIVE ASSET FORMAT: ${assetFormatLabel}
${vectorRule}

GENERATE THESE FIELDS:

1. TITLE (single master title)
   - EXACTLY between ${titleMin} and ${titleLimit} characters. Never exceed ${titleLimit}.
   - Start with a clear, compelling literal description of the main subject and action.
   - Use the remaining space to embed high-volume long-tail keywords aligned with current microstock search trends.
   - Plain text only: letters, numbers, spaces, commas, periods, hyphens. No emojis or special characters.

2. SUGGESTED FILENAME
   - Single lowercase, hyphen-separated string ending in .${safeFileType} (e.g., stack-of-pancakes-with-syrup.${safeFileType}).
   - Reflect the asset format. No spaces, no underscores, no uppercase.

3. KEYWORDS (auto-rank algorithm)
   - Exactly ${keywordsLimit} keywords or fewer — NEVER exceed ${keywordsLimit}.
   - All lowercase. No special characters (letters, numbers, spaces, hyphens only).
   - Strict ratio: ~70% single-word keywords, ~30% high-quality two-word phrases.
   - Demand ranking: position the highest-demand, top-converting commercial search terms in the FIRST 10 keywords for maximum Shutterstock + Adobe Stock visibility.
   - No duplicates, no stop-word-only phrases, no brand names unless visibly present.
   - ${vectorRule}

4. CATEGORY MAPPING
   - adobeCategory: one official Adobe Stock category name.
   - shutterstockCategory: one official Shutterstock category name.

5. LEGAL / RIGHTS METADATA (always include verbatim)
   - copyright: "Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved."
   - rights: "Microstock Commercial License"
   - author: "Microstock Contributor"

OUTPUT FORMAT — return ONLY this JSON object, nothing else:
{
  "filename": "suggested-filename.${safeFileType}",
  "title": "Master title between ${titleMin} and ${titleLimit} characters",
  "keywords": "keyword1, keyword2, ... (max ${keywordsLimit}, 70% single / 30% double-word, top demand first)",
  "adobeCategory": "Category Name",
  "shutterstockCategory": "Category Name",
  "copyright": "Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.",
  "rights": "Microstock Commercial License",
  "author": "Microstock Contributor"
}`;

    const dataModePrompt = `${masterSystemPrompt}

DATA-MODE ADDENDUM (AI training value):
Also include an "aiTrainingNote" field (<= 500 chars) describing what AI models (object detection, emotion recognition, texture mapping, etc.) can learn from this image. Append it to the JSON above. Still no prose outside the JSON object.`;

    let systemPrompt = mode === 'data' ? dataModePrompt : masterSystemPrompt;
    if (typeof customPrompt === 'string' && customPrompt.trim().length > 0 && customPrompt.length < 4000) {
      systemPrompt += `\n\nADDITIONAL USER INSTRUCTIONS (apply to title and keywords):\n${customPrompt.trim()}`;
    }

    console.log(`Generating metadata for ${safeFileType}, available keys: ${apiKeys.length}`);

    // Try each API key
    let lastFailure: ProviderFailure | null = null;
    const failures: ProviderFailure[] = [];
    for (let i = 0; i < apiKeys.length; i++) {
      const { key: apiKey, type: keyType } = apiKeys[i];
      try {
        console.log(`Trying ${keyType} API key ${i + 1}/${apiKeys.length}`);
        
        let response: Response;

        // For vector assets (EPS/SVG), the model cannot see pixels. Build a
        // text-only user message so providers don't reject the image_url payload.
        const vectorUserText = `Generate microstock metadata for a VECTOR ${safeFileType.toUpperCase()} asset. ${customPrompt ? customPrompt + ' ' : ''}Respond with the required JSON only.`;
        const vectorRasterUserText = `The attached image is a rasterized PNG preview of a VECTOR ${safeFileType.toUpperCase()} artwork. Analyze what is VISUALLY drawn (characters, subjects, scene, style, colors, composition) and generate microstock metadata describing the actual artwork — DO NOT guess from the filename. Include vector-appropriate keywords where they genuinely fit. ${customPrompt ? customPrompt + ' ' : ''}Respond with the required JSON only.`;
        const rasterUserTextOpenAI = isVector ? vectorRasterUserText : "Analyze this image and generate optimized metadata for microstock submission.";
        const rasterUserTextGroq = isVector ? vectorRasterUserText : "Analyze this image and generate optimized metadata for microstock submission. Respond with the required JSON only.";
        const rasterUserTextGemini = isVector ? vectorRasterUserText : 'Analyze the attached image and respond with the required JSON only.';
        const rasterUserTextLovable = isVector ? vectorRasterUserText : "Analyze this image and generate optimized metadata for microstock submission.";

        if (keyType === 'openai') {
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                isVectorPayload
                  ? { role: "user", content: vectorUserText }
                  : {
                      role: "user",
                      content: [
                        { type: "text", text: rasterUserTextOpenAI },
                        { type: "image_url", image_url: { url: imageBase64 } }
                      ]
                    }
              ],
              max_tokens: 1000
            }),
          });
        } else if (keyType === 'groq') {
          response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: isVectorPayload
                ? "llama-3.3-70b-versatile"
                : "qwen/qwen3.6-27b",
              messages: [
                { role: "system", content: systemPrompt },
                isVectorPayload
                  ? { role: "user", content: vectorUserText }
                  : {
                      role: "user",
                      content: [
                        { type: "text", text: rasterUserTextGroq },
                        { type: "image_url", image_url: { url: imageBase64 } }
                      ]
                    }
              ],
              max_tokens: 1500,
              response_format: { type: "json_object" }
            }),
          });
        } else if (keyType === 'gemini') {
          const base64Match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
          const mimeType = base64Match?.[1] || 'image/jpeg';
          const rawBase64 = base64Match?.[2] || imageBase64.split(',').pop() || '';
          const parts: Array<Record<string, unknown>> = [
            { text: `${systemPrompt}\n\n${isVectorPayload ? vectorUserText : rasterUserTextGemini}` }
          ];
          if (!isVectorPayload) {
            parts.push({ inline_data: { mime_type: mimeType, data: rawBase64 } });
          }
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: { response_mime_type: "application/json", maxOutputTokens: 1500 }
            }),
          });
        } else if (keyType === 'agentrouter') {
          response = await fetch("https://agentrouter.org/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                isVectorPayload
                  ? { role: "user", content: vectorUserText }
                  : {
                      role: "user",
                      content: [
                        { type: "text", text: rasterUserTextOpenAI },
                        { type: "image_url", image_url: { url: imageBase64 } }
                      ]
                    }
              ],
              max_tokens: 1000
            }),
          });
        } else {
          // Lovable AI Gateway
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                isVectorPayload
                  ? { role: "user", content: vectorUserText }
                  : {
                      role: "user",
                      content: [
                        { type: "text", text: rasterUserTextLovable },
                        { type: "image_url", image_url: { url: imageBase64 } }
                      ]
                    }
              ]
            }),
          });
        }


        if (response.status === 429) {
          const errBody = await response.text().catch(() => '');
          console.log(`[${keyType}] 429:`, errBody.slice(0, 300));
          // OpenAI returns insufficient_quota with 429 — treat as payment_required, non-retryable for this key.
          const isQuota = /insufficient_quota|exceeded your current quota|billing/i.test(errBody);
          lastFailure = {
            provider: keyType,
            status: isQuota ? 402 : 429,
            code: isQuota ? 'payment_required' : 'rate_limited',
            message: isQuota
              ? `${keyType.toUpperCase()} quota exhausted. Add credits or use a different provider key.`
              : 'Metadata generation is rate limited. Try again later or add another API key.',
            retryable: !isQuota,
          };
          failures.push(lastFailure);
          continue;
        }

        if (response.status === 402) {
          await response.text().catch(() => '');
          console.log(`[${keyType}] 402 payment required`);
          lastFailure = {
            provider: keyType,
            status: 402,
            code: 'payment_required',
            message: 'Default AI credits are exhausted. Add an OpenAI, Gemini, Groq, or AgentRouter API key in AI API Keys, or add AI credits, then try again.',
            retryable: false,
          };
          failures.push(lastFailure);
          continue;
        }

        // Gemini returns 400 for invalid API key (not 401); OpenAI/Groq use 401/403.
        if (response.status === 401 || response.status === 403 || (keyType === 'gemini' && response.status === 400)) {
          const errBody = await response.text().catch(() => '');
          console.log(`[${keyType}] auth/key error ${response.status}:`, errBody.slice(0, 300));
          // For Gemini 400, only treat as invalid key if message indicates so; otherwise treat as provider_error.
          const isKeyError = response.status !== 400 || /API key|API_KEY_INVALID|permission|unauthor/i.test(errBody);
          if (isKeyError) {
            lastFailure = {
              provider: keyType,
              status: 401,
              code: 'invalid_api_key',
              message: `${keyType.toUpperCase()} API key is invalid or lacks permission. Remove it and add a valid key.`,
              retryable: false,
            };
            failures.push(lastFailure);
            continue;
          }
          lastFailure = {
            provider: keyType,
            status: 400,
            code: 'provider_error',
            message: `${keyType.toUpperCase()} returned an error: ${errBody.slice(0, 200)}`,
            retryable: false,
          };
          failures.push(lastFailure);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`[${keyType}] API error ${response.status}:`, errorText.slice(0, 500));
          const isImageTooLarge = /image too large|too many pixels|image_too_large|max.*pixels/i.test(errorText);
          lastFailure = {
            provider: keyType,
            status: response.status >= 500 ? 503 : response.status,
            code: isImageTooLarge ? 'image_too_large' : 'provider_error',
            message: isImageTooLarge
              ? `${keyType.toUpperCase()} rejected the image as too large. Trying next provider.`
              : `${keyType.toUpperCase()} error (${response.status}). Trying next key if available.`,
            retryable: response.status >= 500 || isImageTooLarge,
          };
          failures.push(lastFailure);
          continue;
        }

        const data = await response.json();
        const content = keyType === 'gemini'
          ? (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '')
          : data.choices?.[0]?.message?.content;
        
        if (!content) {
          lastFailure = {
            provider: keyType,
            status: 502,
            code: 'empty_ai_response',
            message: 'Metadata provider returned an empty response. Please try again.',
            retryable: true,
          };
          failures.push(lastFailure);
          continue;
        }

        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastFailure = {
            provider: keyType,
            status: 502,
            code: 'invalid_ai_response',
            message: 'Metadata provider returned an unreadable response. Please try again.',
            retryable: true,
          };
          failures.push(lastFailure);
          continue;
        }

        let metadata: Record<string, unknown>;
        try {
          metadata = JSON.parse(jsonMatch[0]);
        } catch (_parseError) {
          lastFailure = {
            provider: keyType,
            status: 502,
            code: 'invalid_ai_json',
            message: 'Metadata provider returned invalid JSON. Please try again.',
            retryable: true,
          };
          failures.push(lastFailure);
          continue;
        }
        
        // Sanitize title (respect FP-mode limits if active)
        const sanitizedTitle = (String(metadata.title || ''))
          .replace(/[^a-zA-Z0-9\s,.\-]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, titleLimit);

        // Sanitize keywords (respect FP-mode limits if active)
        const seen = new Set<string>();
        const sanitizedKeywords = (String(metadata.keywords || ''))
          .split(',')
          .map((k: string) => k.trim().toLowerCase().replace(/[^a-z0-9\s\-]/g, '').replace(/\s+/g, ' ').trim())
          .filter((k: string) => {
            if (!k || k.length > 50) return false;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, keywordsLimit)
          .join(', ');

        const LEGAL_COPYRIGHT = 'Copyright 2026 Adobe Stock / Shutterstock Contributor. All Rights Reserved.';
        const LEGAL_RIGHTS = 'Microstock Commercial License';
        const LEGAL_AUTHOR = 'Microstock Contributor';

        console.log(`Metadata generated successfully using ${keyType} API`);
        return new Response(JSON.stringify({
          filename: String(metadata.filename || `image.${safeFileType}`),
          title: sanitizedTitle,
          keywords: sanitizedKeywords,
          adobeCategory: String(metadata.adobeCategory || 'Lifestyle'),
          shutterstockCategory: String(metadata.shutterstockCategory || 'Miscellaneous'),
          copyright: LEGAL_COPYRIGHT,
          rights: LEGAL_RIGHTS,
          author: LEGAL_AUTHOR,
          aiTrainingNote: typeof metadata.aiTrainingNote === 'string' ? metadata.aiTrainingNote.slice(0, 1000) : undefined
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error(`Error with ${keyType} API key:`, error);
        lastFailure = {
          provider: keyType,
          status: 503,
          code: 'provider_exception',
          message: error instanceof Error ? error.message : 'Metadata provider failed unexpectedly.',
          retryable: true,
        };
        failures.push(lastFailure);
      }
    }

    // All keys failed
    const userFailures = failures.filter((f) => f.provider !== 'lovable');

    for (const failure of userFailures) {
      console.error(`All API keys failed: ${failure.provider}: ${failure.message} (code: ${failure.code})`);
    }

    const combinedMessage = userFailures.length > 0
      ? userFailures.map((f) => `${f.provider.toUpperCase()}: ${f.message} (code: ${f.code})`).join('\n')
      : 'Metadata service unavailable. Please try again.';

    return new Response(JSON.stringify({
      error: combinedMessage,
      code: 'all_providers_failed',
      retryable: true,
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-metadata function:", error);
    return new Response(JSON.stringify({ error: 'Failed to generate metadata' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

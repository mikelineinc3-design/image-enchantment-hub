import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FILE_TYPES = ['jpg', 'png', 'eps', 'svg'];
const MAX_BASE64_SIZE = 20 * 1024 * 1024;

interface ApiKeyEntry {
  key: string;
  type: 'lovable' | 'openai' | 'groq' | 'gemini';
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
    const { imageBase64, fileType = 'jpg', customApiKeys, mode = 'default', customPrompt, groqApiKeys } = await req.json();
    
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
    
    // Validate base64 format - must be a valid data URL
    // Support various image formats including PNG with different mime type variations
    const dataUrlMatch = imageBase64.match(/^data:image\/(jpeg|jpg|png|gif|webp|x-png);base64,/i);
    if (!dataUrlMatch) {
      // Also check if it's a raw base64 without prefix (shouldn't happen but handle gracefully)
      const hasBase64Content = imageBase64.length > 100 && imageBase64.includes(',');
      if (!hasBase64Content) {
        console.error('Invalid image data URL format:', imageBase64.substring(0, 100));
        return new Response(JSON.stringify({ error: 'Invalid image format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      // Try to use the image anyway if it has content after comma
      console.log('Non-standard data URL format, attempting to use anyway');
    }
    
    const safeFileType = ALLOWED_FILE_TYPES.includes(fileType) ? fileType : 'jpg';
    
    // Collect API keys with their types
    const apiKeys: ApiKeyEntry[] = [];
    
    // Add custom OpenAI keys first (user-provided)
    if (customApiKeys && Array.isArray(customApiKeys)) {
      for (const k of customApiKeys) {
        if (
          typeof k === 'string' &&
          k.length >= 20 &&
          k.length <= 200 &&
          /^[A-Za-z0-9_\-]+$/.test(k)
        ) {
          apiKeys.push({ key: k, type: 'openai' });
        }
      }
    }

    // Add custom Groq keys (user-provided). Groq keys are typically prefixed with "gsk_".
    if (groqApiKeys && Array.isArray(groqApiKeys)) {
      for (const k of groqApiKeys) {
        if (
          typeof k === 'string' &&
          k.length >= 20 &&
          k.length <= 200 &&
          /^[A-Za-z0-9_\-]+$/.test(k)
        ) {
          apiKeys.push({ key: k, type: 'groq' });
        }
      }
    }
    
    // Add Lovable API key as fallback
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
    const fileTypeContext = isVector 
      ? "This is a VECTOR file (EPS/SVG). Include keywords like 'vector', 'eps', 'illustration', 'clipart', 'graphic design'."
      : "This is a PHOTO/RASTER file (JPG/PNG). NEVER use keywords like 'vector', 'eps', 'illustration', or 'clipart'.";

    const dataModePrompt = `Act as an expert Shutterstock Contributor SEO manager. Analyze this uploaded image and provide the following for Shutterstock metadata:

Title/Description: Write a clear, descriptive, and literal title (under 200 characters). Focus on exactly what is happening, the subject's action, the setting, and light conditions. Avoid poetic or metaphorical words.

Keywords (Tags): Provide 40-50 highly relevant keywords separated by commas. Include literal objects, background details, color tones, emotional states/expressions, camera angles (e.g., close-up, top-view), and specific use-cases (e.g., AI training data, computer vision, machine learning datasets).

AI Training Value Note: Briefly explain what specific AI models (like object detection, emotion recognition, or texture mapping) can learn from this image.

RESPOND IN EXACT JSON FORMAT:
{
  "filename": "suggested-filename.${safeFileType}",
  "title": "Literal descriptive title under 200 chars",
  "keywords": "keyword1, keyword2, ... (40-50 keywords)",
  "adobeCategory": "Category Name",
  "shutterstockCategory": "Category Name",
  "aiTrainingNote": "Brief AI training value note"
}`;

    const defaultPrompt = `You are an expert microstock metadata generator for Adobe Stock and Shutterstock.

${fileTypeContext}

Generate:
1. Filename: Clean hyphenated filename (main-subject-action-context.${safeFileType})
2. Title: STRICTLY under 195 characters. NO special characters (only letters, numbers, spaces, commas, periods, hyphens). First 5-7 words must be a clear sentence.
3. EXACTLY 45 keywords, comma-separated, lowercase only, no special characters:
   - Keywords 1-10: Most critical subjects
   - Keywords 11-25: High-searched commercial terms
   - Keywords 26-45: Mood, aesthetic terms${isVector ? ", 'vector', 'illustration', 'eps'" : ""}
4. Categories for Adobe Stock and Shutterstock

RESPOND IN EXACT JSON FORMAT:
{
  "filename": "suggested-filename.${safeFileType}",
  "title": "Clear title under 195 chars no special characters",
  "keywords": "keyword1, keyword2, ... (exactly 45 keywords)",
  "adobeCategory": "Category Name",
  "shutterstockCategory": "Category Name"
}`;

    let systemPrompt = mode === 'data' ? dataModePrompt : defaultPrompt;
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
        
        if (keyType === 'openai') {
          // Direct OpenAI API call
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Analyze this image and generate optimized metadata for microstock submission." },
                    { type: "image_url", image_url: { url: imageBase64 } }
                  ]
                }
              ],
              max_tokens: 1000
            }),
          });
        } else if (keyType === 'groq') {
          // Groq (OpenAI-compatible). llama-3.3-70b-versatile is text-only,
          // so send a description-style prompt without the image payload.
          response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Generate optimized microstock metadata for the uploaded image based on the system instructions. Respond with the required JSON only." }
              ],
              max_tokens: 1500,
              response_format: { type: "json_object" }
            }),
          });
        } else {
          // Lovable AI Gateway
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Analyze this image and generate optimized metadata for microstock submission." },
                    { type: "image_url", image_url: { url: imageBase64 } }
                  ]
                }
              ]
            }),
          });
        }

        if (response.status === 429) {
          console.log('Rate limited, trying next key...');
          await response.text().catch(() => '');
          lastFailure = {
            provider: keyType,
            status: 429,
            code: 'rate_limited',
            message: 'Metadata generation is rate limited. Try again later or add another API key.',
            retryable: true,
          };
          failures.push(lastFailure);
          continue;
        }

        if (response.status === 402) {
          console.log('Payment required, trying next key...');
          await response.text().catch(() => '');
          lastFailure = {
            provider: keyType,
            status: 402,
            code: 'payment_required',
            message: 'Default AI credits are exhausted. Add an OpenAI or Groq API key in AI API Keys, or add AI credits, then try again.',
            retryable: false,
          };
          failures.push(lastFailure);
          continue;
        }

        if (response.status === 401) {
          console.log('Invalid API key, trying next key...');
          await response.text().catch(() => '');
          lastFailure = {
            provider: keyType,
            status: 401,
            code: 'invalid_api_key',
            message: 'A metadata API key is invalid. Remove it and add a valid key, then try again.',
            retryable: false,
          };
          failures.push(lastFailure);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error:", response.status, errorText);
          lastFailure = {
            provider: keyType,
            status: response.status >= 500 ? 503 : response.status,
            code: 'provider_error',
            message: 'Metadata provider returned an error. Please try another API key or try again later.',
            retryable: response.status >= 500,
          };
          failures.push(lastFailure);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
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
        
        // Sanitize title (max 195 chars, only alphanumeric + spaces, commas, periods, hyphens)
        const sanitizedTitle = (String(metadata.title || ''))
          .replace(/[^a-zA-Z0-9\s,.\-]/g, '') // Strict: only letters, numbers, basic punctuation
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 195);
        
        // Sanitize keywords (max 45, only lowercase alphanumeric + spaces, hyphens - NO special chars)
        const sanitizedKeywords = (String(metadata.keywords || ''))
          .split(',')
          .map((k: string) => k.trim().toLowerCase().replace(/[^a-z0-9\s\-]/g, '').replace(/\s+/g, ' ').trim())
          .filter((k: string) => k.length > 0 && k.length <= 50)
          .slice(0, 45)
          .join(', ');

        console.log(`Metadata generated successfully using ${keyType} API`);
        return new Response(JSON.stringify({
          filename: String(metadata.filename || `image.${safeFileType}`),
          title: sanitizedTitle,
          keywords: sanitizedKeywords,
          adobeCategory: String(metadata.adobeCategory || 'Lifestyle'),
          shutterstockCategory: String(metadata.shutterstockCategory || 'Miscellaneous'),
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
    const selectedFailure = failures.find((failure) => failure.code === 'payment_required')
      || failures.find((failure) => failure.code === 'rate_limited')
      || (failures.length > 0 && failures.every((failure) => failure.code === 'invalid_api_key') ? failures[0] : null)
      || lastFailure;

    console.error('All API keys failed:', selectedFailure);
    return new Response(JSON.stringify({
      error: selectedFailure?.message || 'Metadata service unavailable. Please try again.',
      code: selectedFailure?.code || 'metadata_unavailable',
      retryable: selectedFailure?.retryable ?? true,
    }), {
      status: selectedFailure?.status || 503,
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

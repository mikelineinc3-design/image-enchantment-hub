import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FILE_TYPES = ['jpg', 'png', 'eps', 'svg'];
const MAX_BASE64_SIZE = 20 * 1024 * 1024;

interface ApiKeyEntry {
  key: string;
  type: 'lovable' | 'openai';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType = 'jpg', customApiKeys } = await req.json();
    
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
    
    const safeFileType = ALLOWED_FILE_TYPES.includes(fileType) ? fileType : 'jpg';
    
    // Collect API keys with their types
    const apiKeys: ApiKeyEntry[] = [];
    
    // Add custom OpenAI keys first (user-provided)
    if (customApiKeys && Array.isArray(customApiKeys)) {
      for (const k of customApiKeys) {
        if (typeof k === 'string' && k.length > 20) {
          apiKeys.push({ key: k, type: 'openai' });
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

    const systemPrompt = `You are an expert microstock metadata generator for Adobe Stock and Shutterstock.

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

    console.log(`Generating metadata for ${safeFileType}, available keys: ${apiKeys.length}`);

    // Try each API key
    let lastError = null;
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
          lastError = new Error('Rate limited');
          continue;
        }

        if (response.status === 402) {
          console.log('Payment required, trying next key...');
          lastError = new Error('Payment required');
          continue;
        }

        if (response.status === 401) {
          console.log('Invalid API key, trying next key...');
          lastError = new Error('Invalid API key');
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error:", response.status, errorText);
          lastError = new Error(`API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
          lastError = new Error("No response from AI");
          continue;
        }

        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = new Error("No JSON found in response");
          continue;
        }

        const metadata = JSON.parse(jsonMatch[0]);
        
        // Sanitize title (max 195 chars, no special characters)
        const sanitizedTitle = (metadata.title || '')
          .replace(/[^\w\s,.-]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 195);
        
        // Sanitize keywords (max 45)
        const sanitizedKeywords = (metadata.keywords || '')
          .split(',')
          .map((k: string) => k.trim().toLowerCase().replace(/[^\w\s-]/g, ''))
          .filter((k: string) => k.length > 0)
          .slice(0, 45)
          .join(', ');

        console.log(`Metadata generated successfully using ${keyType} API`);
        return new Response(JSON.stringify({
          filename: metadata.filename || `image.${safeFileType}`,
          title: sanitizedTitle,
          keywords: sanitizedKeywords,
          adobeCategory: metadata.adobeCategory || 'Lifestyle',
          shutterstockCategory: metadata.shutterstockCategory || 'Miscellaneous'
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error(`Error with ${keyType} API key:`, error);
        lastError = error;
      }
    }

    // All keys failed
    console.error('All API keys failed:', lastError);
    return new Response(JSON.stringify({ error: 'Metadata service unavailable. Please try again.' }), {
      status: 503,
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

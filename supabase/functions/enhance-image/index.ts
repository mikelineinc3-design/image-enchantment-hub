import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FILTERS = ['vibrant', 'cinematic', 'natural', 'default', 'product', 'sharpener', 'hdr'];
const MAX_BASE64_SIZE = 20 * 1024 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, filters = ['default'], customApiKeys, preserveFormat = false } = await req.json();
    
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
    const dataUrlMatch = imageBase64.match(/^data:image\/(jpeg|jpg|png|gif|webp|x-png);base64,/i);
    if (!dataUrlMatch) {
      console.error('Invalid image data URL format:', imageBase64.substring(0, 100));
      return new Response(JSON.stringify({ error: 'Invalid image format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Detect if image is PNG
    const isPng = imageBase64.toLowerCase().startsWith('data:image/png') || imageBase64.toLowerCase().startsWith('data:image/x-png');
    
    // Normalize filters input - support both single filter string and array
    let filterList: string[] = [];
    if (Array.isArray(filters)) {
      filterList = filters.filter((f: unknown) => typeof f === 'string' && ALLOWED_FILTERS.includes(f as string));
    } else if (typeof filters === 'string' && ALLOWED_FILTERS.includes(filters)) {
      filterList = [filters];
    }
    if (filterList.length === 0) {
      filterList = ['default'];
    }
    
    // Collect API keys — user's Gemini keys first (correct endpoint below),
    // then Lovable as last-resort fallback.
    // NOTE: the frontend passes Gemini AI Studio keys into this `customApiKeys`
    // param (see Index.tsx). They must be sent to Gemini's own endpoint, not
    // Lovable's gateway — Gemini keys are not valid Lovable gateway tokens.
    interface EnhanceKeyEntry { key: string; type: 'gemini' | 'lovable'; }
    const apiKeys: EnhanceKeyEntry[] = [];
    const isValidKey = (k: unknown): k is string =>
      typeof k === 'string' && k.trim().length >= 20 && k.trim().length <= 500;
    if (customApiKeys && Array.isArray(customApiKeys)) {
      for (const k of customApiKeys) if (isValidKey(k)) apiKeys.push({ key: k.trim(), type: 'gemini' });
    }
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

    const filterPrompts: Record<string, string> = {
      vibrant: "Enhance with rich, saturated colors. Increase color intensity while maintaining natural look. Make the image pop with vivid tones.",
      cinematic: "Apply cinematic color grade with subtle teal and orange tones, adjust contrast for movie-like feel. Keep it professional and atmospheric.",
      natural: "Enhance naturally. Improve exposure, slightly boost colors while maintaining realism. Professional photograph in ideal lighting conditions.",
      default: "Enhance professionally. Improve overall quality, adjust exposure, increase color vibrancy while keeping it realistic.",
      product: "Enhance clarity, increase micro-details, improve color accuracy, reduce noise, and apply studio-style lighting with neutral background separation.",
      sharpener: "Enhance details significantly. Increase sharpness and micro-contrast for crisp, clear edges throughout the image.",
      hdr: "Improve dynamic range, recover shadow details, highlight texture, and enhance brightness while keeping the image natural and realistic."
    };

    // Combine prompts from all selected filters
    const combinedPrompts = filterList.map(f => filterPrompts[f] || filterPrompts.default);
    
    // Add PNG-specific instructions if preserving format
    let prompt = `Enhance this photo with the following improvements:\n${combinedPrompts.join('\n')}`;
    if (isPng && preserveFormat) {
      prompt += '\n\nCRITICAL: This is a PNG image with potential transparency. You MUST preserve any transparent areas exactly as they are. Do NOT add any background color to transparent regions. Keep the alpha channel intact.';
    }
    
    console.log(`Processing ${isPng ? 'PNG' : 'JPEG'} image with filters: ${filterList.join(', ')}, preserve format: ${preserveFormat}, available keys: ${apiKeys.length}`);

    // Try each API key until one works
    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
      const { key: apiKey, type: keyType } = apiKeys[i];
      try {
        console.log(`Trying ${keyType} API key ${i + 1}/${apiKeys.length}`);
        
        // Add timeout to prevent hanging connections
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

        let response: Response;

        if (keyType === 'gemini') {
          const base64Match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
          const mimeType = base64Match?.[1] || 'image/jpeg';
          const rawBase64 = base64Match?.[2] || imageBase64.split(',').pop() || '';
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: rawBase64 } }
                  ]
                }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
              }),
              signal: controller.signal
            }
          );
        } else {
          // Lovable AI Gateway (last-resort fallback)
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image-preview",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: imageBase64 } }
                  ]
                }
              ],
              modalities: ["image", "text"]
            }),
            signal: controller.signal
          });
        }
        
        clearTimeout(timeoutId);

        if (response.status === 429) {
          console.log(`[${keyType}] Rate limited, trying next key...`);
          lastError = new Error('Rate limited');
          continue;
        }

        if (response.status === 402) {
          console.log(`[${keyType}] Payment required, trying next key...`);
          lastError = new Error('Payment required');
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`[${keyType}] API error:`, response.status, errorText.slice(0, 500));
          lastError = new Error(`API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        let enhancedImageUrl: string | undefined;
        let messageText: string | undefined;

        if (keyType === 'gemini') {
          const parts = data.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
          if (imagePart?.inlineData) {
            enhancedImageUrl = `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`;
          }
          messageText = parts.find((p: { text?: string }) => p.text)?.text;
        } else {
          enhancedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          messageText = data.choices?.[0]?.message?.content;
        }
        
        if (!enhancedImageUrl) {
          console.error(`[${keyType}] No image in response`);
          lastError = new Error("No enhanced image returned");
          continue;
        }

        // Validate the enhanced image URL format
        if (!enhancedImageUrl.startsWith('data:image/')) {
          console.error(`[${keyType}] Invalid enhanced image format returned`);
          lastError = new Error("Invalid enhanced image format");
          continue;
        }

        console.log(`Image enhanced successfully via ${keyType}. Original: ${isPng ? 'PNG' : 'JPEG'}, Result format: ${enhancedImageUrl.substring(0, 30)}...`);
        return new Response(JSON.stringify({ 
          enhancedImage: enhancedImageUrl,
          message: messageText || "Image enhanced successfully",
          originalFormat: isPng ? 'png' : 'jpeg',
          preserveFormat: preserveFormat
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('Request timed out');
          lastError = new Error('Request timed out');
        } else {
          console.error(`Error with ${keyType} API key:`, error);
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    // All keys failed
    console.error('All API keys failed:', lastError);
    return new Response(JSON.stringify({ error: 'Enhancement service unavailable. Please try again.' }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in enhance-image function:", error);
    return new Response(JSON.stringify({ error: 'Failed to process image' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

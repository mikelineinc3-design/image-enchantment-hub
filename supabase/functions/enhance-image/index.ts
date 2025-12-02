import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FILTERS = ['vibrant', 'cinematic', 'natural', 'default'];
const MAX_BASE64_SIZE = 20 * 1024 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, filter = 'default', customApiKeys } = await req.json();
    
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
    
    const safeFilter = ALLOWED_FILTERS.includes(filter) ? filter : 'default';
    
    // Collect API keys - custom keys first, then Lovable key
    const apiKeys: string[] = [];
    if (customApiKeys && Array.isArray(customApiKeys)) {
      apiKeys.push(...customApiKeys.filter((k: unknown) => typeof k === 'string' && (k as string).length > 20));
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      apiKeys.push(LOVABLE_API_KEY);
    }
    
    if (apiKeys.length === 0) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const filterPrompts: Record<string, string> = {
      vibrant: "Enhance this photo to make it more vibrant with rich, saturated colors. Increase color intensity while maintaining natural look. Make the image pop with vivid tones.",
      cinematic: "Apply a cinematic color grade to this photo. Add subtle teal and orange tones, adjust contrast for a movie-like feel. Keep it professional and atmospheric.",
      natural: "Enhance this photo naturally. Improve exposure, slightly boost colors while maintaining realism. Make it look like a professional photograph taken in ideal lighting conditions.",
      default: "Enhance this photo professionally. Improve overall quality, adjust exposure, increase color vibrancy while keeping it realistic. Make it look high quality and appealing."
    };

    const prompt = filterPrompts[safeFilter] || filterPrompts.default;
    console.log(`Processing image with filter: ${safeFilter}, available keys: ${apiKeys.length}`);

    // Try each API key until one works
    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      try {
        console.log(`Trying API key ${i + 1}/${apiKeys.length}`);
        
        // Add timeout to prevent hanging connections
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        
        clearTimeout(timeoutId);

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

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error:", response.status, errorText);
          lastError = new Error(`API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const enhancedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        
        if (!enhancedImageUrl) {
          console.error("No image in response");
          lastError = new Error("No enhanced image returned");
          continue;
        }

        console.log("Image enhanced successfully");
        return new Response(JSON.stringify({ 
          enhancedImage: enhancedImageUrl,
          message: data.choices?.[0]?.message?.content || "Image enhanced successfully"
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('Request timed out');
          lastError = new Error('Request timed out');
        } else {
          console.error('Error with API key:', error);
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

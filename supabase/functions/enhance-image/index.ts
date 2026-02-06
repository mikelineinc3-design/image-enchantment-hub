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
    
    // Detect if image is PNG
    const isPng = imageBase64.startsWith('data:image/png');
    
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
      prompt += '\n\nIMPORTANT: This is a PNG image. Preserve any transparency in the image. Do not add a background to transparent areas.';
    }
    
    console.log(`Processing ${isPng ? 'PNG' : 'JPEG'} image with filters: ${filterList.join(', ')}, available keys: ${apiKeys.length}`);

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
        let enhancedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        
        if (!enhancedImageUrl) {
          console.error("No image in response");
          lastError = new Error("No enhanced image returned");
          continue;
        }

        // If original was PNG and we need to preserve format, convert JPEG result back to PNG
        // Note: The AI might return JPEG, so we need to handle this on client side
        // Here we just pass the format info back
        console.log("Image enhanced successfully");
        return new Response(JSON.stringify({ 
          enhancedImage: enhancedImageUrl,
          message: data.choices?.[0]?.message?.content || "Image enhanced successfully",
          originalFormat: isPng ? 'png' : 'jpeg'
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

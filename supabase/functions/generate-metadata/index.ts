import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const isVector = fileType === 'eps' || fileType === 'svg';
    const fileTypeContext = isVector 
      ? "This is a VECTOR file (EPS/SVG). Include keywords like 'vector', 'eps', 'illustration', 'clipart', 'graphic design'."
      : "This is a PHOTO/RASTER file (JPG/PNG). NEVER use keywords like 'vector', 'eps', 'illustration', or 'clipart'.";

    const systemPrompt = `You are an expert microstock metadata generator for Adobe Stock and Shutterstock. Your goal is to generate high-converting, SEO-optimized metadata.

${fileTypeContext}

Analyze the image and generate:
1. A clean hyphenated filename based on the main subject (format: main-subject-action-context.${fileType})
2. An optimized title (STRICTLY under 200 characters). First 5-7 words must form a clear sentence describing the image. Use remaining space for long-tail keywords.
3. EXACTLY 49 keywords ordered by relevance:
   - Keywords 1-10: Most critical subjects and direct details
   - Keywords 11-30: Highest searched terms, commercial concepts, synonyms
   - Keywords 31-49: Indirect relevance, mood, aesthetic${isVector ? ", 'vector', 'illustration', 'eps'" : ""}
   Format: lowercase, comma-separated, no special characters
4. Categories for Adobe Stock and Shutterstock

RESPOND IN THIS EXACT JSON FORMAT:
{
  "filename": "suggested-filename.${fileType}",
  "title": "Your optimized title here",
  "keywords": "keyword1, keyword2, keyword3, ... keyword49",
  "adobeCategory": "Category Name",
  "shutterstockCategory": "Category Name"
}`;

    console.log(`Generating metadata for ${fileType} file`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this image and generate optimized metadata for microstock submission."
              },
              {
                type: "image_url",
                image_url: { url: imageBase64 }
              }
            ]
          }
        ]
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error("No response from AI");
    }

    // Parse JSON from response
    let metadata;
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        metadata = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse metadata:", content);
      throw new Error("Failed to parse AI response");
    }

    console.log("Metadata generated successfully");

    return new Response(JSON.stringify(metadata), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-metadata function:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

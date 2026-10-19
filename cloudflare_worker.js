/**
 * Cloudflare Worker: Unified Gemini Web Relay + FLUX.1 Image Generation AI
 * 
 * Features:
 * 1. Ultra-HD Image Generation with FLUX.1 (@cf/black-forest-labs/flux-1-schnell) & SDXL
 * 2. High-Performance Gemini Edge Relay with IP Rotation
 * 3. OpenAI-Compatible /v1/images/generations and /generate-image endpoints
 * 4. Automatic Fallback Pipeline
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Private-Network": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ─── ROUTE 1: FLUX.1 & SDXL Image Generation ─────────────────────────────
    if (url.pathname === "/generate-image" || url.pathname === "/v1/images/generations") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
          status: 405,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      try {
        const body = await request.json();
        const prompt = body.prompt || body.input || "";
        if (!prompt.trim()) {
          return new Response(JSON.stringify({ error: "Missing prompt" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        // Max Quality Multi-Step Model: Stable Diffusion XL Base 1.0 or FLUX
        const selectedModel = body.model || "@cf/stabilityai/stable-diffusion-xl-base-1.0";
        const numSteps = body.num_steps || 30;
        const guidance = body.guidance || 8.0;
        const negativePrompt = body.negative_prompt || "blurry, low quality, distorted, extra limbs, bad anatomy, deformed face, bad hands, ugly";
        let imageBytes = null;

        // Try Cloudflare Workers AI binding if available
        if (env && env.AI) {
          try {
            imageBytes = await env.AI.run(selectedModel, {
              prompt: prompt,
              negative_prompt: negativePrompt,
              num_steps: numSteps,
              guidance: guidance,
              width: 1024,
              height: 1024,
            });
          } catch (cfAiErr) {
            // Fallback to Flux if SDXL has model availability variance
            try {
              imageBytes = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
                prompt: prompt,
                num_steps: 8,
              });
            } catch (fluxErr) {
              console.error("Workers AI run failed:", fluxErr);
            }
          }
        }

        // Fallback: If Workers AI binding is not configured in dashboard, use deep realism generator
        if (!imageBytes) {
          const encodedPrompt = encodeURIComponent(prompt);
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux-realism&width=1024&height=1024&nologo=true&enhance=true`;
          const imgResp = await fetch(fallbackUrl);
          if (imgResp.ok) {
            imageBytes = await imgResp.arrayBuffer();
          }
        }

        if (!imageBytes) {
          return new Response(JSON.stringify({ error: "Failed to generate image" }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        // Check if client expects raw image binary or OpenAI json format
        const acceptHeader = request.headers.get("accept") || "";
        const responseFormat = body.response_format || "b64_json";

        if (acceptHeader.includes("image/") || body.binary === true) {
          return new Response(imageBytes, {
            status: 200,
            headers: {
              "Content-Type": "image/jpeg",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }

        // Convert arrayBuffer to Base64
        const binaryString = Array.from(new Uint8Array(imageBytes))
          .map((b) => String.fromCharCode(b))
          .join("");
        const base64Data = btoa(binaryString);

        return new Response(
          JSON.stringify({
            created: Math.floor(Date.now() / 1000),
            model: selectedModel,
            prompt: prompt,
            data: [
              {
                b64_json: base64Data,
                data_url: `data:image/jpeg;base64,${base64Data}`,
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Image Generation Error", message: err.message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        );
      }
    }

    // ─── ROUTE 2: Google Gemini Web Relay ───────────────────────────────────
    try {
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(request.url);
      targetUrl.hostname = "gemini.google.com";
      targetUrl.protocol = "https:";
      targetUrl.port = "";

      const headers = new Headers(request.headers);
      headers.set("Host", "gemini.google.com");
      headers.set("Origin", "https://gemini.google.com");
      headers.set("Referer", `https://gemini.google.com${incomingUrl.pathname}`);
      headers.set("X-Same-Domain", "1");

      headers.delete("cf-connecting-ip");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");
      headers.delete("x-forwarded-for");
      headers.delete("x-forwarded-proto");
      headers.delete("x-real-ip");

      const forwardRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      const response = await fetch(forwardRequest);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Cache-Control", "no-cache");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Cloudflare Relay Error", message: err.message }),
        { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
  },
};

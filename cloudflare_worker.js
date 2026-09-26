/**
 * Cloudflare Worker: High-Performance Gemini Edge Relay
 * 
 * Instructions:
 * 1. Log in to https://dash.cloudflare.com
 * 2. Go to "Workers & Pages" -> "Create Application" -> "Create Worker"
 * 3. Name it: "gemini-relay" and click "Deploy"
 * 4. Click "Edit code", replace everything with this code, and click "Deploy"
 * 5. Copy your worker URL (e.g. https://gemini-relay.<subdomain>.workers.dev)
 * 6. Set CLOUDFLARE_WORKER_URL=<your-worker-url> in your app's .env file!
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      // 1. Rewrite target URL from Worker domain to gemini.google.com
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(request.url);
      targetUrl.hostname = "gemini.google.com";
      targetUrl.protocol = "https:";
      targetUrl.port = "";

      // 2. Clone headers and set proper Google Gemini origins
      const headers = new Headers(request.headers);
      headers.set("Host", "gemini.google.com");
      headers.set("Origin", "https://gemini.google.com");
      headers.set("Referer", `https://gemini.google.com${incomingUrl.pathname}`);
      headers.set("X-Same-Domain", "1");

      // Clean up headers that might leak or cause conflicts
      headers.delete("cf-connecting-ip");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");
      headers.delete("x-forwarded-for");
      headers.delete("x-forwarded-proto");
      headers.delete("x-real-ip");

      // 3. Forward request through Cloudflare's global edge network
      const forwardRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      const response = await fetch(forwardRequest);

      // 4. Return the response with CORS and keep streaming alive
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin": "*");
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

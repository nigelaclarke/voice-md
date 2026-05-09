// Ephemeral client-secret minter for realtime-voice-component's
// `getClientSecret` auth flow. Used as an alternative to the multipart-proxy
// `sessionEndpoint` flow when we want the browser to negotiate WebRTC with
// OpenAI directly (one less hop, easier to debug, identical session shape).
//
// Doc: https://platform.openai.com/docs/api-reference/realtime-client-secrets

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[token-route] OPENAI_API_KEY is not configured");
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Empty session: the actual session config is set via session.update
      // events from the browser AFTER the WebRTC channel opens. The
      // realtime-voice-component does this automatically.
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
        },
      }),
    });
  } catch (err) {
    console.error("[token-route] fetch threw:", err);
    return new Response(
      JSON.stringify({
        error: "Upstream fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const text = await upstream.text();
  const dt = Date.now() - t0;
  if (!upstream.ok) {
    console.error(`[token-route] upstream ${upstream.status} in ${dt}ms — body:`, text.slice(0, 500));
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.info(`[token-route] minted client_secret in ${dt}ms`);
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

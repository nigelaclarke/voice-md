// Multipart SDP proxy for realtime-voice-component.
// The browser POSTs sdp + session config; we forward to OpenAI Realtime.
// See realtime-voice-component/LLM.txt step 2.

export const runtime = "nodejs";
// Make sure this route is not cached or pre-rendered.
export const dynamic = "force-dynamic";
// Allow up to 30s — WebRTC SDP exchange + the OpenAI dial can take 5-15s.
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[session-route] OPENAI_API_KEY is not configured");
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const contentType = request.headers.get("content-type");
  // Buffer the entire body before forwarding. Streaming via `duplex: "half"`
  // is flaky under Next.js 16 / Turbopack — buffering is reliable and the
  // SDP+session payload is tiny.
  const t0 = Date.now();
  const buffer = await request.arrayBuffer();
  console.info(
    `[session-route] forwarding ${buffer.byteLength}B (${contentType ?? "no-type"})`,
  );

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: buffer,
    });
  } catch (err) {
    console.error("[session-route] fetch threw:", err);
    return new Response(
      JSON.stringify({
        error: "Upstream fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await upstream.text();
  const dt = Date.now() - t0;
  if (upstream.ok) {
    console.info(
      `[session-route] upstream ${upstream.status} in ${dt}ms (${body.length}B)`,
    );
  } else {
    console.error(
      `[session-route] upstream ${upstream.status} in ${dt}ms — body:`,
      body.slice(0, 500),
    );
  }
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/sdp",
    },
  });
}

// Multipart SDP proxy for realtime-voice-component.
// The browser POSTs sdp + session config; we forward to OpenAI Realtime.
// See realtime-voice-component/LLM.txt step 2.

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const contentType = request.headers.get("content-type");

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: request.body,
    // duplex: "half" is required when streaming a request body, but TS lib
    // types lag behind the runtime — cast to add the property.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/sdp",
    },
  });
}

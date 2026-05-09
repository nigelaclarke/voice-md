// Diagnostic endpoint: builds our exact session config (instructions + tools)
// and posts it to /v1/realtime/calls with a stub SDP. Returns whatever
// validation error OpenAI throws. Lets us reproduce session-config bugs
// without needing a browser/WebRTC handshake.

import { SYSTEM_PROMPT } from "@/lib/prompt";
import { z } from "zod";
import { toJSONSchema } from "zod";

// Mirror lib/tools.ts inline (defineVoiceTool is client-only so we can't
// import it server-side). Reconstruct the JSON-Schema-shaped tool defs
// the same way the library does.
function stripSchemaMetadata(s: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _$schema, definitions: _definitions, $ref, ...rest } = s as {
    $schema?: unknown;
    definitions?: unknown;
    $ref?: string;
    [k: string]: unknown;
  };
  if (typeof $ref === "string" && _definitions) {
    const map = _definitions as Record<string, unknown>;
    const key = $ref.split("/").at(-1);
    if (key && key in map) {
      return stripSchemaMetadata(map[key] as Record<string, unknown>);
    }
  }
  return rest;
}
function toolFor(name: string, description: string, schema: z.ZodSchema) {
  const json = stripSchemaMetadata(toJSONSchema(schema as never) as Record<string, unknown>);
  return { type: "function", name, description, parameters: json };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stub SDP that's just barely a valid SDP — the API will validate session
// fields BEFORE rejecting on bad SDP, so we see config errors first if they exist.
const STUB_SDP = `v=0
o=- 0 0 IN IP4 0.0.0.0
s=-
t=0 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
a=ice-ufrag:abcd
a=ice-pwd:abcdefghijklmnopqrstuv
a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
a=setup:actpass
a=mid:0
a=sendrecv
`;

export async function GET(): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "no key" }, { status: 500 });
  }

  // Reconstruct OUR exact tool shapes by re-deriving from the same Zod
  // schemas (defineVoiceTool itself is client-only).
  const transformSelectionSchema = z.object({
    primary: z.string().min(1),
    intent: z.string().max(40),
  });
  const insertAtCursorSchema = z.object({ text: z.string().min(1) });
  const dialSpec = z.object({
    type: z.literal("dial"),
    axes: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          ticks: z.array(z.string()).min(2).max(5),
        }),
      )
      .min(1)
      .max(2),
    values: z.record(z.string(), z.record(z.string(), z.string())),
  });
  const cardsSpec = z.object({
    type: z.literal("cards"),
    options: z
      .array(z.object({ label: z.string(), preview: z.string(), full: z.string() }))
      .min(2)
      .max(4),
  });
  const chipSpec = z.object({
    type: z.literal("chip"),
    label: z.string(),
    followup: z.string(),
  });
  const renderUISchema = z.discriminatedUnion("type", [dialSpec, cardsSpec, chipSpec]);

  const session = {
    type: "realtime",
    model: "gpt-realtime-1.5",
    instructions: SYSTEM_PROMPT,
    tool_choice: "auto",
    tools: [
      toolFor("transformSelection", "Replace the user's selected text", transformSelectionSchema),
      toolFor("insertAtCursor", "Insert markdown at cursor", insertAtCursorSchema),
      toolFor("renderUI", "Render an affordance", renderUISchema),
    ],
    output_modalities: ["text"],
    audio: {
      input: {
        transcription: { model: "gpt-4o-transcribe" },
        turn_detection: null,
      },
    },
  };

  // Print what we're sending so we can see the JSON Schemas of our tools.
  console.info("[diag] sending session config:");
  console.info(JSON.stringify(session, null, 2));

  // Build the multipart body.
  const fd = new FormData();
  fd.set("sdp", STUB_SDP);
  fd.set("session", JSON.stringify(session));

  const t0 = Date.now();
  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  const text = await upstream.text();
  const dt = Date.now() - t0;
  console.info(`[diag] upstream ${upstream.status} in ${dt}ms`);

  return Response.json(
    {
      upstreamStatus: upstream.status,
      upstreamMs: dt,
      upstreamBody: text,
      sentSession: session,
    },
    { status: 200 },
  );
}

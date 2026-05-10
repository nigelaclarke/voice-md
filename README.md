# VoiceMD

A voice-driven markdown editor. Hover the talk zone, speak an instruction about the selected text, mouse out to commit. The model rewrites the selection in place, then optionally surfaces a follow-up affordance (a length dial, alternate cards, or a single follow-up chip) so you can keep iterating.

The model never speaks aloud — every utterance lands as a tool call against the editor.

## Setup

```bash
pnpm install
cp .env.local.example .env.local
# put your OpenAI API key in .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), select some text, and hover the talk zone.

`OPENAI_API_KEY` is only used server-side by the two API routes — it is never exposed to the browser. The browser receives a short-lived ephemeral `client_secret` from `/api/realtime-token` and negotiates WebRTC with OpenAI directly.

## Sibling dependency

`realtime-voice-component` is a `file:../realtime-voice-component` linked dependency. Clone it as a sibling directory before running `pnpm install`.

## Scripts

- `pnpm dev` — Next.js dev server
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` — ESLint

## How it works

**Gesture.** Two hover zones (a fixed anchor and a selection-following region) drive a small state machine: `idle → listening → grace → thinking → applying`. A 250ms grace window absorbs the cursor warp between zones; a 350ms minimum turn duration discards accidental brushes.

**Tools.** The model has exactly three tools:

- `transformSelection({ primary, intent })` — Stage 1, replaces the selection.
- `insertAtCursor({ text })` — empty-selection / dictation path.
- `renderUI({ surface })` — Stage 2, optional follow-up affordance. `surface` is one of `dial` (axis variants), `cards` (alternate interpretations), or `chip` (single follow-up offer).

**Two-stage flow.** After Stage 1 lands, a focused system message is injected and a follow-up response is requested manually so the model produces a `renderUI` call (or nothing). Mechanical edits — bold, typo fixes, deletions — skip Stage 2.

## Architecture pointers

- `components/editor.tsx` — the only file that touches Milkdown / ProseMirror; exposes a small imperative `EditorHandle`.
- `components/voice.tsx` — composition root; owns the realtime controller, the voice adapter, and the zone-state machine.
- `lib/tools.ts` — Zod-schema tool definitions.
- `lib/prompt.ts` — system prompt + per-turn context builder.
- `lib/zone-state.ts` — hover-driven turn lifecycle.
- `lib/ui-state.ts` — pub/sub store for last-transform memory and active surface.
- `app/api/realtime-token/route.ts` — ephemeral client-secret minter (the path actually used).
- `app/api/realtime-session/route.ts` — alternate multipart SDP proxy (kept for reference).

See [CLAUDE.md](CLAUDE.md) for deeper architecture notes and the non-obvious pitfalls baked into the code.

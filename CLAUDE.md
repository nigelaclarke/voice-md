# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm**.

- `pnpm dev` — Next.js dev server on http://localhost:3000
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` — ESLint (Next.js core-web-vitals + TS, with `react-hooks/refs` and `react-hooks/set-state-in-effect` downgraded to warn)

There is no test suite.

`OPENAI_API_KEY` must be set in `.env.local` (see `.env.local.example`). The key is only used server-side by the two API routes — never exposed to the browser.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript 5 · Milkdown 7 (CommonMark + history) · OpenAI Realtime API via WebRTC.

`realtime-voice-component` is a **file:../realtime-voice-component** sibling-linked dependency, listed in `transpilePackages` in [next.config.ts](next.config.ts) so Turbopack honours its `exports` field. React Strict Mode is disabled in dev because the controller owns a long-lived WebRTC peer connection — double-mounting races two `connect()` attempts and hangs.

## Architecture

The system is a voice-driven markdown editor with a hover-to-talk gesture. The model emits **only tool calls** — never spoken text. Three tools cover all output:

1. `transformSelection({ primary, intent })` — Stage 1, replaces the selection.
2. `insertAtCursor({ text })` — empty-selection / dictation path.
3. `renderUI({ surface })` — Stage 2, optional follow-up affordance (dial / cards / chip).

### Two-stage flow

Stage 2 is **manually triggered** from [components/voice.tsx](components/voice.tsx) inside `onToolSuccess`, not by the realtime library's `postToolResponse` auto-loop. Reason: the auto-loop gives the model an unconstrained text turn that it abuses (replies "(no further action)" in plain text). Instead, we set `postToolResponse: false` and after a `transformSelection` lands, send a focused system message + `requestResponse()` ourselves. `MECHANICAL_INTENT` regex skips Stage 2 for purely syntactic edits (bold, typo fix, delete, etc.) — there's nothing to iterate on.

`toolChoice: "auto"` overrides the realtime-voice-component default of `required` for tool-only mode. With `required`, the model is forced to call a tool even on no-op turns ("um", silence) and produces junk edits.

### Module map

- **[app/page.tsx](app/page.tsx)** — top-level layout. Dynamically imports the editor (SSR-disabled) so the Milkdown/ProseMirror code never runs server-side. The `editorRef` is created here and threaded into `<Voice>`. **Don't move the editor render into voice.tsx** — it would break the dynamic-import boundary.
- **[components/editor.tsx](components/editor.tsx)** — the only file that knows ProseMirror exists. Exposes `EditorHandle` (`getSelection`, `getDocument`, `replaceSelection`, `insertAtCursor`, `getSelectionRect`, `setPendingHighlight`, `flashFreshHighlight`). Owns the decoration plugin (pending + fresh highlights) keyed on `decorationPluginKey`. `replaceSelection` returns the **post-edit** range — used for surface anchoring and for subsequent dial-tick re-edits against the same region.
- **[components/voice.tsx](components/voice.tsx)** — composition root. Owns the realtime controller, voice adapter, zone-state machine, selection-rect tracking, and the surface anchor. Wires server events into both the in-app log and the watchdog ring buffer.
- **[components/surface.tsx](components/surface.tsx)** — host for the active affordance, anchored to the just-edited selection rect. Re-measures on scroll and doc changes.
- **[components/catalog.tsx](components/catalog.tsx)** — the three primitives (Dial, AlternativeCards, Chip). Renders directly from the model-emitted spec; A2UI is intentionally bypassed here (see comment at top of catalog.tsx).
- **[components/talk-zone.tsx](components/talk-zone.tsx)** — the hover-target for the gesture. Two variants: `anchor` (fixed) and `selection` (follows the selection rect).
- **[lib/tools.ts](lib/tools.ts)** — the three tool definitions and their Zod schemas. `renderUI`'s argument wraps the discriminated `surfaceSpec` under a `surface` field because OpenAI's function-calling validator rejects discriminated unions at the root (it requires `type: "object"` at top level).
- **[lib/prompt.ts](lib/prompt.ts)** — `SYSTEM_PROMPT` (tool-only, language-matching) and `buildContextMessage` (sent into the conversation on every turn open with the selection, full document, and active-surface JSON).
- **[lib/zone-state.ts](lib/zone-state.ts)** — combined-hover state machine: `idle → listening → grace → thinking → applying`. 250ms grace absorbs cursor warps between zones; 350ms `MIN_TURN_DURATION_MS` discards accidental brushes. `thinking` and `applying` are LOCKED — re-hovers ignored. Window blur is treated as a hard zone-leave.
- **[lib/ui-state.ts](lib/ui-state.ts)** — pub/sub store for `lastTransform` (range, anchor rect, intent, original/current text) and `activeSurface`. 10s idle dismissal + Esc dismissal armed when a surface is shown.
- **[app/api/realtime-token/route.ts](app/api/realtime-token/route.ts)** — primary auth path. Mints an ephemeral `client_secret` from `https://api.openai.com/v1/realtime/client_secrets`. The browser uses this to negotiate WebRTC directly with OpenAI.
- **[app/api/realtime-session/route.ts](app/api/realtime-session/route.ts)** — alternate path: multipart SDP proxy to `https://api.openai.com/v1/realtime/calls`. Used by the realtime-voice-component's `sessionEndpoint` flow. The current implementation in voice.tsx uses the **client-secret** flow (`auth.getClientSecret`) and ignores this route.

### Pitfalls baked into the code

- **DOMRect reference equality**: `getBoundingClientRect` and `view.coordsAtPos` return a fresh DOMRect every call, even when geometry hasn't moved. React's default setState bailout sees them as different and re-renders, which re-fires the listener (selectionchange / ResizeObserver) that produced the rect — infinite loop. The `rectsEqual()` helper at the bottom of voice.tsx is mandatory anywhere a DOMRect feeds into setState or a useEffect dep.
- **Don't call `controller.configure()` after mount.** It replaces the entire options object and silently drops `onEvent`, `onError`, `onToolStart`, `onToolSuccess`. Tools/adapter are memoised stable for the lifetime of the component, so the initial `createVoiceControlController` options are correct. If tools genuinely change, use `controller.updateTools()` (doesn't touch callbacks).
- **Watchdog**: a 25s timer in `zone.status === "thinking" | "applying"` resets state and dumps the last 30 server events from the ring buffer. Useful when the model fails to produce a tool call.
- **Stage-2 timing**: the manual `requestResponse()` is deferred by 120ms so the library finishes sending `function_call_output` for the just-completed call before the next response kicks off.

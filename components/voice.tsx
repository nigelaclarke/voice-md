"use client";

// voice.tsx — composition root for the voice loop.
//
// Owns:
//   - the realtime-voice-component controller (push-to-talk, tool-only)
//   - the voice adapter (closure over editor ref + ui-state store)
//   - the zone-state machine (combined hover for both talk zones)
//   - selection-rect tracking for the floating selection-zone
//   - the talk zones, status pill, transcript chip, and the surface anchor
//
// The editor ref is passed in via prop. We never render the editor here —
// it lives in app/page.tsx so the dynamic import boundary stays intact.

import {
  createVoiceControlController,
  GhostCursorOverlay,
  useGhostCursor,
  type VoiceControlController,
  type VoiceControlError,
} from "realtime-voice-component";
import "realtime-voice-component/styles.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { EditorHandle, SelectionInfo } from "@/components/editor";
import { ErrorBanner } from "@/components/error-banner";
import { TalkZone } from "@/components/talk-zone";
import { TranscriptChip } from "@/components/transcript-chip";
import { Surface } from "@/components/surface";
import { buildContextMessage, buildDocMessage, SYSTEM_PROMPT } from "@/lib/prompt";
import {
  buildTools,
  type InsertAtCursorArgs,
  type SurfaceSpec,
  type TransformSelectionArgs,
} from "@/lib/tools";
import { uiStore } from "@/lib/ui-state";
import { useZoneState, type ZoneId } from "@/lib/zone-state";

interface VoiceProps {
  editorRef: RefObject<EditorHandle | null>;
  // When false, hide the selection zone (e.g. while in source view).
  selectionZoneEnabled?: boolean;
}

const SELECTION_ZONE_APPEAR_DELAY = 250;

export function Voice({ editorRef, selectionZoneEnabled = true }: VoiceProps) {
  // ---- Selection-rect tracking (for the selection-following talk zone) ----

  const [pendingSelectionRect, setPendingSelectionRect] = useState<DOMRect | null>(
    null,
  );
  const [selectionZoneRect, setSelectionZoneRect] = useState<DOMRect | null>(
    null,
  );
  const selectionDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const update = () => {
      const handle = editorRef.current;
      if (!handle || !handle.isReady()) {
        // Clear via value-equal setState so we don't re-render when already null.
        setPendingSelectionRect((prev) => (prev === null ? prev : null));
        setSelectionZoneRect((prev) => (prev === null ? prev : null));
        return;
      }
      const rect = handle.getSelectionRect();
      // CRITICAL: getBoundingClientRect / view.coordsAtPos return a fresh
      // DOMRect every call, even when the geometry hasn't changed. Comparing
      // by reference (React's default setState bailout) sees them as
      // different and re-renders, which re-fires this listener (it's bound
      // to scroll/selectionchange), creating an infinite render loop. Gate
      // on a value comparison instead.
      setPendingSelectionRect((prev) => (rectsEqual(prev, rect) ? prev : rect));
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editorRef]);

  // Debounce the selection-zone visibility — don't appear until selection has
  // been stable for `SELECTION_ZONE_APPEAR_DELAY` ms (avoids flicker during drag).
  useEffect(() => {
    if (selectionDelayTimerRef.current !== null) {
      clearTimeout(selectionDelayTimerRef.current);
      selectionDelayTimerRef.current = null;
    }
    if (!pendingSelectionRect) {
      setSelectionZoneRect((prev) => (prev === null ? prev : null));
      return;
    }
    // If we already had a rect, update immediately (selection moved while
    // the zone was already shown). Otherwise wait for the delay.
    if (selectionZoneRect) {
      setSelectionZoneRect((prev) =>
        rectsEqual(prev, pendingSelectionRect) ? prev : pendingSelectionRect,
      );
      return;
    }
    selectionDelayTimerRef.current = setTimeout(() => {
      setSelectionZoneRect((prev) =>
        rectsEqual(prev, pendingSelectionRect) ? prev : pendingSelectionRect,
      );
    }, SELECTION_ZONE_APPEAR_DELAY);
    return () => {
      if (selectionDelayTimerRef.current !== null) {
        clearTimeout(selectionDelayTimerRef.current);
        selectionDelayTimerRef.current = null;
      }
    };
    // selectionZoneRect intentionally not in deps — the "first appear" logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelectionRect]);

  // ---- Zone DOMRect (for transcript chip anchoring) ----

  const [selectionZoneScreenRect, setSelectionZoneScreenRect] =
    useState<DOMRect | null>(null);
  const onZoneRect = useCallback((_zone: ZoneId, rect: DOMRect | null) => {
    // Same DOMRect-reference trap — the ResizeObserver inside TalkZone calls
    // this on every layout pass with a fresh DOMRect; compare by value.
    setSelectionZoneScreenRect((prev) => (rectsEqual(prev, rect) ? prev : rect));
  }, []);

  // ---- Voice adapter (stable ref; closes over editor + ui-state) ----

  // Snapshot range at hover-enter — used as the canonical replacement target
  // even if the user clicks away mid-turn.
  const pendingRangeRef = useRef<{ from: number; to: number; text: string } | null>(
    null,
  );
  const pendingRectRef = useRef<DOMRect | null>(null);

  const adapter = useMemo(
    () => ({
      applyTransform: (args: TransformSelectionArgs) => {
        console.info("[voice:adapter] applyTransform", {
          intent: args.intent,
          primaryLength: args.primary.length,
          range: pendingRangeRef.current
            ? {
                from: pendingRangeRef.current.from,
                to: pendingRangeRef.current.to,
              }
            : null,
        });
        const handle = editorRef.current;
        if (!handle) {
          console.warn("[voice:adapter] applyTransform: no editor handle");
          return;
        }
        const range = pendingRangeRef.current;
        const original = range?.text ?? "";
        const anchorRect = pendingRectRef.current;
        // Apply the replacement against the snapshotted range.
        let postRange: { from: number; to: number } | null = null;
        try {
          postRange = handle.replaceSelection(
            args.primary,
            range ? { from: range.from, to: range.to } : undefined,
          );
        } catch (err) {
          console.error("[voice:adapter] replaceSelection threw", err);
          throw err;
        }
        if (!postRange) {
          // Markdown couldn't be parsed; fall back to a naive estimate so the
          // surface still has something to anchor to.
          postRange = range
            ? { from: range.from, to: range.from + args.primary.length }
            : { from: 0, to: args.primary.length };
        }
        console.info("[voice:adapter] applyTransform → postRange", postRange);
        const prevSurface = uiStore.snapshot.activeSurface;
        uiStore.setLastTransform({
          range: postRange,
          anchorRect,
          intent: args.intent,
          originalText: original,
          currentText: args.primary,
        });
        // If a dial surface is active and this transform matches one of its
        // ticks, sync the visual selection so the user sees the dot move.
        if (prevSurface && prevSurface.spec.type === "dial") {
          for (const axis of prevSurface.spec.axes) {
            const axisVariants = prevSurface.spec.values[axis.id];
            if (!axisVariants) continue;
            const match = Object.entries(axisVariants).find(
              ([, text]) => text === args.primary,
            );
            if (match) {
              uiStore.updateSurfaceAxis(axis.id, match[0]);
              break;
            }
          }
        }
      },
      applyInsert: (args: InsertAtCursorArgs) => {
        console.info("[voice:adapter] applyInsert", {
          textLength: args.text.length,
        });
        editorRef.current?.insertAtCursor(args.text);
      },
      showSurface: (spec: SurfaceSpec) => {
        const last = uiStore.snapshot.lastTransform;
        console.info("[voice:adapter] showSurface", {
          type: spec.type,
          hasLastTransform: !!last,
          anchorRect: last?.anchorRect
            ? {
                left: Math.round(last.anchorRect.left),
                top: Math.round(last.anchorRect.top),
                width: Math.round(last.anchorRect.width),
                height: Math.round(last.anchorRect.height),
              }
            : null,
          spec:
            spec.type === "dial"
              ? {
                  axes: spec.axes.map((a) => ({
                    id: a.id,
                    ticks: a.ticks,
                  })),
                }
              : { optionCount: spec.options.length },
        });
        uiStore.showSurface({
          spec,
          anchorRect: last?.anchorRect ?? null,
        });
      },
    }),
    [editorRef],
  );

  // ---- Tools + controller ----

  const tools = useMemo(() => buildTools(adapter), [adapter]);

  const [error, setError] = useState<VoiceControlError | null>(null);

  // Ring buffer of the last 30 server events. Dumped to the log when the
  // watchdog fires so we can see what the model actually did (or didn't).
  const recentEventsRef = useRef<Array<{ ts: number; type: string; event: unknown }>>(
    [],
  );

  // Controller ref so the onToolSuccess callback (which is built inside the
  // initial createVoiceControlController call, before `controller` is
  // assigned) can reach the controller for Stage-2 follow-up triggering.
  const controllerRef = useRef<VoiceControlController | null>(null);

  const [controller] = useState(() =>
    createVoiceControlController({
      // Use the ephemeral client-secret flow: the browser negotiates WebRTC
      // directly with OpenAI using a short-lived secret minted by our
      // /api/realtime-token route. This bypasses the multipart proxy entirely
      // and is the simpler, faster, easier-to-debug path.
      auth: {
        getClientSecret: async () => {
          const r = await fetch("/api/realtime-token", { method: "POST" });
          if (!r.ok) {
            const detail = await r.text().catch(() => "");
            throw new Error(
              `Failed to mint realtime client secret: ${r.status} ${detail.slice(0, 200)}`,
            );
          }
          const payload = await r.json();
          // Per the realtime-voice-component docs the value lives on
          // payload.value, payload.client_secret.value, or payload.client_secret.
          const secret =
            payload.value ??
            payload.client_secret?.value ??
            payload.client_secret;
          if (!secret) {
            throw new Error(
              `Mint route returned no client secret: ${JSON.stringify(payload).slice(0, 200)}`,
            );
          }
          return secret as string;
        },
      },
      instructions: SYSTEM_PROMPT,
      // gpt-realtime-1.5 is the GA model OpenAI's demos run on; gpt-realtime
      // is older. Both are available on the account (we listed /v1/models).
      model: "gpt-realtime-1.5",
      outputMode: "tool-only",
      activationMode: "push-to-talk",
      tools,
      // Override the implicit `required` that realtime-voice-component sets
      // for tool-only mode. With required, the model is forced to call a
      // tool even on no-op turns ("um", silence, etc.), producing junk
      // edits. Auto lets the model do nothing for those.
      toolChoice: "auto",
      // TEMP: live input transcription disabled to reduce latency. Re-enable
      // by uncommenting the block below — that turns the TranscriptChip back on
      // and restores the [voice:user-said] log entries.
      // audio: {
      //   input: {
      //     transcription: { model: "gpt-4o-transcribe" },
      //   },
      // },
      // We DON'T autoConnect; we connect explicitly in the mount effect
      // below so we get clean timing telemetry and a single deterministic
      // connect path (autoConnect would race with the explicit call).
      autoConnect: false,
      // We do NOT use the library's postToolResponse auto-loop — when given
      // an extra turn the model tends to emit text ("(no further action)")
      // instead of calling renderUI. Instead, the adapter manually triggers
      // a Stage-2 response right after editorial transforms (see below),
      // with a focused system message that primes the model for renderUI.
      postToolResponse: false,
      // Surface every realtime event into the console so you can debug what
      // the model is (or isn't) doing in DevTools. Local events are
      // voice.transport.*, voice.capture.*, voice.tool.* — server events are
      // raw realtime.*.
      onEvent: (event) => {
        const t = (event as { type?: string }).type ?? "?";
        // Skip the firehose of audio frames if it ever comes through.
        if (t === "response.audio.delta" || t === "input_audio_buffer.append") {
          return;
        }
        // Capture into the ring buffer for the watchdog dump.
        const buf = recentEventsRef.current;
        buf.push({ ts: Date.now(), type: t, event });
        if (buf.length > 30) buf.shift();

        // Surface the user's transcribed audio prominently — that's how we
        // confirm the mic is actually capturing speech (vs the assistant's
        // text response which lives on the controller's `transcript` field).
        if (t === "conversation.item.input_audio_transcription.completed") {
          const ev = event as { transcript?: string };
          console.info(
            "[voice:user-said]",
            JSON.stringify(ev.transcript ?? "").slice(0, 200),
          );
        } else if (t === "conversation.item.input_audio_transcription.failed") {
          const ev = event as { error?: { message?: string } };
          console.warn(
            "[voice:user-said] FAILED:",
            ev.error?.message ?? JSON.stringify(event).slice(0, 200),
          );
        }

        if (t.startsWith("voice.")) {
          // Library-emitted local lifecycle events.
          console.info("[voice:event]", t);
        } else if (t === "error" || t.endsWith(".error") || t === "response.failed") {
          console.error("[voice:server-error]", t, JSON.stringify(event).slice(0, 600));
        } else if (
          // Highest-signal events: full payload.
          t === "session.created" ||
          t === "session.updated" ||
          t === "response.created" ||
          t === "response.done" ||
          t === "response.output_item.added" ||
          t === "response.output_item.done" ||
          t === "response.function_call_arguments.done" ||
          t === "response.text.done" ||
          t === "response.output_text.done" ||
          t === "conversation.item.input_audio_transcription.delta" ||
          t === "conversation.item.input_audio_transcription.completed" ||
          t === "conversation.item.input_audio_transcription.failed" ||
          t === "input_audio_buffer.committed" ||
          t === "input_audio_buffer.speech_started" ||
          t === "input_audio_buffer.speech_stopped"
        ) {
          console.info("[voice:server]", t, JSON.stringify(event).slice(0, 800));
        } else if (
          t.startsWith("response.") ||
          t.startsWith("conversation.") ||
          t.startsWith("session.") ||
          t.startsWith("input_audio_buffer.") ||
          t.startsWith("rate_limits.")
        ) {
          // Lower-signal events: type only.
          console.debug("[voice:server]", t);
        } else {
          // Anything we don't recognize — log so we don't miss it.
          console.debug("[voice:server:?]", t);
        }
      },
      onToolStart: (call) => {
        console.info("[voice:tool] start →", call.name, call.args);
      },
      onToolSuccess: (call) => {
        console.info("[voice:tool] ok ←", call.name, call.output);
        // Stage 2: after a transformSelection lands, manually prompt the model
        // for a renderUI follow-up. We set postToolResponse: false because
        // the library's auto-loop gives the model an unconstrained text turn
        // that it tends to abuse (replying "(no further action)" in plain
        // text). Instead, we send a focused system message that tells it
        // EXACTLY what we want and trigger response.create ourselves.
        if (call.name === "transformSelection") {
          const args = call.args as
            | { primary?: string; intent?: string }
            | undefined;
          const intent = args?.intent ?? "";
          // Skip purely mechanical edits — there's nothing to iterate on.
          const isMechanical = MECHANICAL_INTENT.test(intent);
          if (isMechanical) {
            console.info(
              "[voice:stage2] skipping (mechanical intent: " + intent + ")",
            );
            return;
          }
          // Defer slightly so the library finishes sending the function_call
          // _output for the just-completed tool call before we kick off the
          // next response.
          setTimeout(() => {
            const c = controllerRef.current;
            if (!c) return;
            const lt = uiStore.snapshot.lastTransform;
            const stageTwoCtx = buildStage2Message({
              intent,
              originalText: lt?.originalText ?? "",
              currentText: args?.primary ?? lt?.currentText ?? "",
            });
            console.info(
              "[voice:stage2] triggering renderUI for intent=" + intent,
            );
            c.sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "system",
                content: [{ type: "input_text", text: stageTwoCtx }],
              },
            });
            c.requestResponse();
          }, 120);
        }
      },
      onToolError: (call) => {
        console.error("[voice:tool] err ←", call.name, call.error);
      },
      onError: (err) => {
        // Lift the structured fields explicitly so the in-app log doesn't
        // collapse to "{}" when `cause` is a non-enumerable Error.
        const causeMsg =
          err.cause instanceof Error
            ? `${err.cause.name}: ${err.cause.message}`
            : err.cause !== undefined
              ? String(err.cause)
              : "(no cause)";
        console.error(
          "[voice:error] code=" +
            (err.code ?? "?") +
            " message=" +
            (err.message ?? "(empty)") +
            " cause=" +
            causeMsg,
        );
        setError(err);
      },
      debug: true,
    }),
  );

  // NOTE: We do NOT call `controller.configure()` after mount. `configure()`
  // replaces the entire options object — which would wipe our onEvent,
  // onError, onToolStart, etc. callbacks unless we pass them again. Since
  // our tools/adapter are memoised stable for the component's lifetime, the
  // initial options passed to createVoiceControlController are already
  // correct. If tools genuinely changed, we'd use `controller.updateTools()`,
  // which doesn't touch callbacks.
  //
  // Earlier we WERE calling configure(), and it silently dropped the
  // callbacks — that's why we never saw [voice:server] events or error
  // reasons after the first frame. The model was responding from its DEFAULT
  // persona because session.update was failing, and we were blind to the
  // failure.

  // Wire the ref now that the controller exists so the closure inside
  // onToolSuccess can reach it.
  controllerRef.current = controller;

  // Track the last full-document text we sent into the conversation. The doc
  // is sent ONCE at session start (pre-send effect below) and re-sent ONLY
  // when its text changes — instead of resending it on every hover. For any
  // non-trivial document this is a large per-turn input-token saving and lets
  // prompt caching kick in across turns. Reset on disconnect because a new
  // session means a fresh conversation history with no doc in it.
  const docSentRef = useRef<string | null>(null);

  const sendDocIfChanged = useCallback(
    (fullDocument: string) => {
      if (fullDocument === docSentRef.current) return;
      console.info(
        "[voice:doc] sending doc (firstSend=" +
          (docSentRef.current === null) +
          ", length=" +
          fullDocument.length +
          ")",
      );
      controller.sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: buildDocMessage(fullDocument) }],
        },
      });
      docSentRef.current = fullDocument;
    },
    [controller],
  );

  // Connect on mount; destroy on unmount. Time the handshake.
  useEffect(() => {
    const t0 = Date.now();
    console.info("[voice:lifecycle] controller.connect() — starting WebRTC handshake");
    void controller.connect().then(
      () => {
        console.info(
          "[voice:lifecycle] controller.connect() RESOLVED in",
          Date.now() - t0,
          "ms",
        );
      },
      (err) => {
        console.error(
          "[voice:lifecycle] controller.connect() REJECTED in",
          Date.now() - t0,
          "ms —",
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        );
      },
    );
    return () => {
      console.info("[voice:lifecycle] controller.destroy()");
      controller.destroy();
    };
  }, [controller]);

  // Subscribe to runtime snapshot for transcript + activity + connectedness.
  // Verbose: log every transition so we can see when connection completes,
  // when activity flips processing → executing → listening, and when
  // transcript first appears.
  const [transcript, setTranscript] = useState("");
  const [voiceActivity, setVoiceActivity] = useState<string>("idle");
  const [connected, setConnected] = useState(false);
  const prevSnapshotRef = useRef<{
    activity: string;
    connected: boolean;
    status: string;
    transcript: string;
    toolCalls: number;
  }>({
    activity: "idle",
    connected: false,
    status: "idle",
    transcript: "",
    toolCalls: 0,
  });
  useEffect(() => {
    const tick = () => {
      const snap = controller.getSnapshot();
      const prev = prevSnapshotRef.current;
      if (snap.connected !== prev.connected) {
        console.info(
          "[voice:snap] connected",
          prev.connected,
          "→",
          snap.connected,
        );
      }
      if (snap.activity !== prev.activity) {
        console.info(
          "[voice:snap] activity",
          prev.activity,
          "→",
          snap.activity,
        );
      }
      if (snap.status !== prev.status) {
        console.info(
          "[voice:snap] status",
          prev.status,
          "→",
          snap.status,
        );
      }
      // Transcript fires once PER CHARACTER as the model streams. Logging
      // every delta floods the log and pushes session.updated /
      // response.created out of the buffer. Only log:
      //   - the first non-empty chunk (start of stream)
      //   - the final stable text (we'll catch it on the next "" reset).
      if (snap.transcript !== prev.transcript) {
        const wasEmpty = (prev.transcript ?? "").length === 0;
        const isEmpty = (snap.transcript ?? "").length === 0;
        if (wasEmpty && !isEmpty) {
          console.info("[voice:snap] transcript-start:", JSON.stringify(snap.transcript ?? "").slice(0, 120));
        } else if (!wasEmpty && isEmpty) {
          console.info("[voice:snap] transcript-cleared (final was:", JSON.stringify(prev.transcript ?? "").slice(0, 200), ")");
        }
        // Mid-stream deltas are NOT logged — open the in-app log to see the
        // surrounding events instead.
      }
      if (snap.toolCalls.length !== prev.toolCalls) {
        const latest = snap.toolCalls[snap.toolCalls.length - 1];
        console.info(
          "[voice:snap] toolCalls",
          prev.toolCalls,
          "→",
          snap.toolCalls.length,
          latest
            ? `latest=${latest.name}(${latest.status})`
            : "",
        );
      }
      prevSnapshotRef.current = {
        activity: snap.activity,
        connected: snap.connected,
        status: snap.status,
        transcript: snap.transcript ?? "",
        toolCalls: snap.toolCalls.length,
      };
      setTranscript(snap.transcript ?? "");
      setVoiceActivity(snap.activity);
      setConnected(snap.connected);
    };
    tick();
    return controller.subscribe(tick);
  }, [controller]);

  // Pre-send the document into the conversation as soon as we're connected
  // AND the editor has mounted, so it sits in the buffer before the first
  // turn — both warming prompt cache and removing the doc from the critical
  // path of the first turn. Polls editor.isReady() because the editor is
  // dynamically imported and there's no readiness callback. The reset on
  // disconnect is in sendDocIfChanged's containing scope (docSentRef gets
  // cleared here so that a re-connect re-sends).
  useEffect(() => {
    if (!connected) {
      docSentRef.current = null;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trySend = () => {
      if (cancelled) return;
      const handle = editorRef.current;
      if (!handle?.isReady()) {
        timer = setTimeout(trySend, 100);
        return;
      }
      sendDocIfChanged(handle.getDocument());
    };
    trySend();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [connected, sendDocIfChanged, editorRef]);

  // ---- Zone state ----

  const zone = useZoneState({
    onTurnOpen: () => {
      console.info("[voice:zone] onTurnOpen — opening turn");
      const handle = editorRef.current;
      if (!handle) {
        console.warn("[voice:zone] onTurnOpen: editor handle not ready");
        return;
      }

      // 1. Snapshot the selection. If there's no selection but an affordance
      // surface is active, treat the last-transform's range as the implicit
      // selection — that's what voice navigation ("shorter", "second one")
      // operates on.
      const sel: SelectionInfo | null = handle.getSelection();
      const lt = uiStore.snapshot.lastTransform;
      const surfaceActive = uiStore.snapshot.activeSurface !== null;
      if (sel) {
        pendingRangeRef.current = { from: sel.from, to: sel.to, text: sel.text };
        pendingRectRef.current = handle.getSelectionRect();
        console.info(
          "[voice:zone] snapshot from selection",
          { from: sel.from, to: sel.to, textLength: sel.text.length },
        );
      } else if (surfaceActive && lt) {
        pendingRangeRef.current = {
          from: lt.range.from,
          to: lt.range.to,
          text: lt.currentText,
        };
        pendingRectRef.current = lt.anchorRect;
        console.info(
          "[voice:zone] snapshot from active-surface lastTransform",
          { from: lt.range.from, to: lt.range.to },
        );
      } else {
        pendingRangeRef.current = null;
        pendingRectRef.current = null;
        console.info("[voice:zone] no selection — empty turn (insertAtCursor path)");
      }

      // 2. Pending highlight for the snapshotted range.
      if (pendingRangeRef.current) {
        handle.setPendingHighlight({
          from: pendingRangeRef.current.from,
          to: pendingRangeRef.current.to,
        });
      }

      // 3. Send doc (only if changed) + per-turn context message into the
      // conversation BEFORE audio. The doc lives in conversation history from
      // the pre-send at connect; sendDocIfChanged is a no-op unless the user
      // has edited the doc since last send. Read activeSurface live from the
      // store rather than the React snapshot captured by this closure — React
      // state may lag the store by a frame.
      const fullDocument = handle.getDocument();
      sendDocIfChanged(fullDocument);
      const selectionText = pendingRangeRef.current?.text ?? null;
      const ctxMsg = buildContextMessage({
        selectionText,
        activeSurface: uiStore.snapshot.activeSurface?.spec ?? null,
      });
      console.info(
        "[voice:zone] sending context message",
        { docLength: fullDocument.length, ctxLength: ctxMsg.length, hasSurface: !!uiStore.snapshot.activeSurface },
      );
      controller.sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: ctxMsg }],
        },
      });

      // 4. Start the audio capture (push-to-talk).
      console.info("[voice:zone] startCapture");
      controller.startCapture();
    },
    onTurnCommit: () => {
      // stopCapture sends input_audio_buffer.commit + response.create.
      console.info("[voice:zone] onTurnCommit — stopCapture (commit + response.create)");
      controller.stopCapture();
    },
    onTurnDiscard: () => {
      // Discard the (silent / no-text) buffer before the model spends tokens.
      // CRITICAL: pauseCapture (not just buffer.clear) — pauseCapture sets
      // localTrack.enabled = false so no further audio leaves the browser.
      // The previous code only sent buffer.clear, which left the mic track
      // active between turns and continued streaming user speech to OpenAI
      // even when the user wasn't hovering. pauseCapture drains the buffer
      // AND mutes the mic without committing or firing response.create.
      console.info("[voice:zone] onTurnDiscard — pauseCapture (mute mic, drain buffer)");
      controller.pauseCapture();
      editorRef.current?.setPendingHighlight(null);
      pendingRangeRef.current = null;
      pendingRectRef.current = null;
    },
  });

  // Mark audio activity once transcript starts arriving (a proxy for
  // "user actually said something audible").
  useEffect(() => {
    if (transcript && transcript.length > 0) {
      zone.reportAudioActivity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  // Watchdog: if we sit in "thinking" or "applying" for 25s without anything
  // happening, the model probably never produced a tool call (or the response
  // is stuck). Force-reset, dump the last 30 server events for diagnosis, and
  // surface a hint so the user can retry.
  useEffect(() => {
    if (zone.status !== "thinking" && zone.status !== "applying") return;
    const timer = setTimeout(() => {
      console.warn(
        "[voice:watchdog] stuck in",
        zone.status,
        "for 25s — resetting. Dumping last events:",
      );
      const buf = recentEventsRef.current.slice(-30);
      if (buf.length === 0) {
        console.warn("[voice:watchdog]   (no server events captured this turn)");
      } else {
        for (const entry of buf) {
          const dt = new Date(entry.ts).toISOString().slice(11, 23);
          const ev = entry.event as Record<string, unknown>;
          // Pull common diagnostic fields explicitly.
          const detail =
            entry.type === "response.done"
              ? ` status=${(ev?.response as { status?: unknown })?.status ?? "?"}`
              : entry.type === "response.failed" || entry.type === "error"
                ? ` ${JSON.stringify(ev).slice(0, 240)}`
                : "";
          console.warn(`[voice:watchdog]   ${dt} ${entry.type}${detail}`);
        }
      }
      editorRef.current?.setPendingHighlight(null);
      zone.setStatus("idle");
      setError({
        code: "unknown",
        message:
          "Model did not produce a tool call within 25s. The log above shows what the model received and emitted.",
      });
    }, 25_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.status]);

  // Drive zone status from the controller's activity.
  useEffect(() => {
    // Only override status when locked OR when transitioning back from a tool
    // call. The hover-driven states (listening / grace) are owned by zone-state.
    if (voiceActivity === "executing") {
      zone.setStatus("applying");
    } else if (voiceActivity === "processing") {
      // Already 'thinking' — leave it.
      if (zone.status !== "thinking" && zone.status !== "applying") {
        zone.setStatus("thinking");
      }
    } else if (voiceActivity === "idle" || voiceActivity === "listening") {
      // After a response completes, the controller's restingActivity is
      // "listening" while connected (only "idle" when disconnected) — so we
      // reset zone status on EITHER. Without this, zone sits in "thinking"
      // forever after a model response, even on success.
      if (zone.status === "applying" || zone.status === "thinking") {
        editorRef.current?.setPendingHighlight(null);
        zone.setStatus("idle");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActivity]);

  // ---- Surface dismissal triggers (next selection / next edit) ----

  useEffect(() => {
    // Dismiss the active surface when the user changes the selection to
    // something other than the post-transform range.
    const handle = editorRef.current;
    if (!handle) return;
    const onSelChange = () => {
      const cur = uiStore.snapshot.activeSurface;
      if (!cur) return;
      const last = uiStore.snapshot.lastTransform;
      const sel = handle.getSelection();
      // If the user clicked elsewhere (different selection from the last
      // transformed range), dismiss.
      if (!sel) return;
      if (
        !last ||
        sel.from !== last.range.from ||
        sel.to !== last.range.to
      ) {
        uiStore.dismissSurface();
      }
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [editorRef]);

  // ---- Ghost cursor overlay (visual confirmation of tool calls) ----

  const ghost = useGhostCursor();

  // ---- Render ----

  return (
    <>
      {selectionZoneEnabled && (
        <TalkZone
          status={zone.status}
          isLocked={zone.isLocked || !connected}
          anchorRect={selectionZoneRect}
          onEnter={zone.enter}
          onLeave={zone.leave}
          onZoneRect={onZoneRect}
        />
      )}
      {/* TEMP: TranscriptChip disabled while live input transcription is off
          (see audio.input.transcription block above). Re-enable together. */}
      {false && (
        <TranscriptChip
          text={transcript}
          visible={zone.status === "listening" || zone.status === "grace"}
          anchorRect={selectionZoneScreenRect}
        />
      )}
      <ErrorBanner
        error={error}
        onRetry={() => {
          setError(null);
          void controller.connect().catch((err) => {
            console.error("[voice] reconnect failed:", err);
          });
        }}
      />
      <Surface
        editorRef={editorRef}
        onAnyInteraction={() => uiStore.bumpIdle()}
        onChipFollowup={(instruction) => {
          // Snapshot the current last-transform's range so the Stage 1 reply
          // lands in the right place when the model executes the followup.
          const lt = uiStore.snapshot.lastTransform;
          if (lt) {
            pendingRangeRef.current = {
              from: lt.range.from,
              to: lt.range.to,
              text: lt.currentText,
            };
            pendingRectRef.current = lt.anchorRect;
          }
          // Send the chip's instruction as a user-typed message into the session,
          // then trigger a response. The model treats it identically to a voice
          // utterance against the same selection context. Doc only crosses the
          // wire if it has changed since the last send.
          const handle = editorRef.current;
          const fullDocument = handle?.getDocument() ?? "";
          sendDocIfChanged(fullDocument);
          controller.sendClientEvent({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: buildContextMessage({
                    selectionText: lt?.currentText ?? null,
                    activeSurface: null,
                  }),
                },
              ],
            },
          });
          controller.sendClientEvent({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: instruction }],
            },
          });
          controller.requestResponse();
          uiStore.dismissSurface();
        }}
      />
      <GhostCursorOverlay state={ghost.cursorState} />
    </>
  );
}

// DOMRect references change every call (getBoundingClientRect /
// view.coordsAtPos return a fresh object even when geometry hasn't moved).
// Compare by VALUE everywhere we feed a rect into setState or a useEffect
// dep, otherwise reference inequality forces a re-render which re-fires
// the listener that produced the rect — infinite loop.
function rectsEqual(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

// Intent labels we treat as purely mechanical edits — no Stage-2 affordance
// makes sense (there's nothing to iterate on). Anything NOT matching is
// considered editorial and gets a Stage-2 renderUI follow-up prompt.
const MECHANICAL_INTENT =
  /\b(bold|italic|underline|strikethrough|format|code-?(?:block|inline)?|link|typo|fix(?:-typo)?|spell|punctu|capital|delete|remove|insert|append|prepend)\b/i;

function buildStage2Message(input: {
  intent: string;
  originalText: string;
  currentText: string;
}): string {
  return [
    `Stage 2 follow-up: you just completed transformSelection with intent="${input.intent}".`,
    "",
    "Now call renderUI with an affordance that lets the user continue iterating on this transform. Choose dial / cards / chip per the system prompt's guidance for this intent.",
    "",
    "Do NOT emit any text response in this turn. Either call renderUI or do nothing. The user does not see text replies.",
    "",
    `Original text (before this transform):\n${JSON.stringify(input.originalText.slice(0, 500))}`,
    "",
    `New text (your transformSelection output, this is the midpoint that should sit on the dial's middle tick / live in the cards' midpoint option):\n${JSON.stringify(input.currentText.slice(0, 500))}`,
  ].join("\n");
}


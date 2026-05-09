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
import { StatusPill } from "@/components/status-pill";
import { TalkZone } from "@/components/talk-zone";
import { TranscriptChip } from "@/components/transcript-chip";
import { Surface } from "@/components/surface";
import { buildContextMessage, SYSTEM_PROMPT } from "@/lib/prompt";
import {
  buildTools,
  type InsertAtCursorArgs,
  type SurfaceSpec,
  type TransformSelectionArgs,
} from "@/lib/tools";
import { uiStore, useUIState } from "@/lib/ui-state";
import { useZoneState, type ZoneId, type ZoneStatus } from "@/lib/zone-state";

interface VoiceProps {
  editorRef: RefObject<EditorHandle | null>;
}

const SELECTION_ZONE_APPEAR_DELAY = 250;

export function Voice({ editorRef }: VoiceProps) {
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
        setPendingSelectionRect(null);
        setSelectionZoneRect(null);
        return;
      }
      const rect = handle.getSelectionRect();
      setPendingSelectionRect(rect);
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
      setSelectionZoneRect(null);
      return;
    }
    // If we already had a rect, update immediately (selection moved while
    // the zone was already shown). Otherwise wait for the delay.
    if (selectionZoneRect) {
      setSelectionZoneRect(pendingSelectionRect);
      return;
    }
    selectionDelayTimerRef.current = setTimeout(() => {
      setSelectionZoneRect(pendingSelectionRect);
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

  // ---- Zone DOMRects (for transcript chip anchoring) ----

  const [zoneRects, setZoneRects] = useState<{
    anchor: DOMRect | null;
    selection: DOMRect | null;
  }>({ anchor: null, selection: null });
  const onZoneRect = useCallback((zone: ZoneId, rect: DOMRect | null) => {
    setZoneRects((prev) =>
      prev[zone] === rect ? prev : { ...prev, [zone]: rect },
    );
  }, []);

  // ---- UI state (active surface, last transform) ----

  const ui = useUIState();

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
        const handle = editorRef.current;
        if (!handle) return;
        const range = pendingRangeRef.current;
        const original = range?.text ?? "";
        const anchorRect = pendingRectRef.current;
        // Apply the replacement against the snapshotted range.
        handle.replaceSelection(
          args.primary,
          range ? { from: range.from, to: range.to } : undefined,
        );
        // Compute the post-edit range so a follow-up Stage 2 dial can replace it.
        const postRange = computePostEditRange(range, args.primary);
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
        editorRef.current?.insertAtCursor(args.text);
      },
      showSurface: (spec: SurfaceSpec) => {
        const last = uiStore.snapshot.lastTransform;
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

  const [controller] = useState(() =>
    createVoiceControlController({
      auth: { sessionEndpoint: "/api/realtime-session" },
      instructions: SYSTEM_PROMPT,
      model: "gpt-realtime",
      outputMode: "tool-only",
      activationMode: "push-to-talk",
      tools,
      // We auto-connect on mount.
      autoConnect: true,
    }),
  );

  // Resync tools/instructions if they ever change (rare — adapter is memoised).
  useEffect(() => {
    controller.configure({
      auth: { sessionEndpoint: "/api/realtime-session" },
      instructions: SYSTEM_PROMPT,
      model: "gpt-realtime",
      outputMode: "tool-only",
      activationMode: "push-to-talk",
      tools,
    });
  }, [controller, tools]);

  // Connect on mount; destroy on unmount.
  useEffect(() => {
    void controller.connect().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[voice] connect failed:", err);
    });
    return () => {
      controller.destroy();
    };
  }, [controller]);

  // Subscribe to runtime snapshot for transcript + activity.
  const [transcript, setTranscript] = useState("");
  const [voiceActivity, setVoiceActivity] = useState<string>("idle");
  useEffect(() => {
    const tick = () => {
      const snap = controller.getSnapshot();
      setTranscript(snap.transcript ?? "");
      setVoiceActivity(snap.activity);
    };
    tick();
    return controller.subscribe(tick);
  }, [controller]);

  // ---- Zone state ----

  const zone = useZoneState({
    onTurnOpen: () => {
      const handle = editorRef.current;
      if (!handle) return;

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
      } else if (surfaceActive && lt) {
        pendingRangeRef.current = {
          from: lt.range.from,
          to: lt.range.to,
          text: lt.currentText,
        };
        pendingRectRef.current = lt.anchorRect;
      } else {
        pendingRangeRef.current = null;
        pendingRectRef.current = null;
      }

      // 2. Pending highlight for the snapshotted range.
      if (pendingRangeRef.current) {
        handle.setPendingHighlight({
          from: pendingRangeRef.current.from,
          to: pendingRangeRef.current.to,
        });
      }

      // 3. Send context system-message into the conversation BEFORE audio.
      // Read activeSurface live from the store rather than the React snapshot
      // captured by this closure — React state may lag the store by a frame.
      const fullDocument = handle.getDocument();
      const selectionText = pendingRangeRef.current?.text ?? null;
      const ctxMsg = buildContextMessage({
        selectionText,
        fullDocument,
        activeSurface: uiStore.snapshot.activeSurface?.spec ?? null,
      });
      controller.sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: ctxMsg }],
        },
      });

      // 4. Start the audio capture (push-to-talk).
      controller.startCapture();
    },
    onTurnCommit: () => {
      // stopCapture sends input_audio_buffer.commit + response.create.
      controller.stopCapture();
    },
    onTurnDiscard: () => {
      // Discard the (silent / no-text) buffer before the model spends tokens.
      controller.sendClientEvent({ type: "input_audio_buffer.clear" });
      // Clear pending highlight.
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
    } else if (voiceActivity === "idle") {
      // Tool flow finished. Clear pending highlight (in case discarded turn
      // didn't clear it) and go to idle.
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

  const activeZoneRect =
    zone.hoveredZones.has("anchor")
      ? zoneRects.anchor
      : zoneRects.selection;

  return (
    <>
      <TalkZone
        variant="anchor"
        status={zone.status}
        isHovered={zone.hoveredZones.has("anchor")}
        isLocked={zone.isLocked}
        onEnter={zone.enter}
        onLeave={zone.leave}
        onZoneRect={onZoneRect}
      />
      <TalkZone
        variant="selection"
        anchorRect={selectionZoneRect}
        status={zone.status}
        isHovered={zone.hoveredZones.has("selection")}
        isLocked={zone.isLocked}
        onEnter={zone.enter}
        onLeave={zone.leave}
        onZoneRect={onZoneRect}
      />
      <TranscriptChip
        text={transcript}
        visible={zone.status === "listening" || zone.status === "grace"}
        anchorRect={activeZoneRect}
      />
      <StatusPill status={mapStatus(zone.status, voiceActivity)} />
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
          // utterance against the same selection context.
          const handle = editorRef.current;
          const fullDocument = handle?.getDocument() ?? "";
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
                    fullDocument,
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

function mapStatus(zone: ZoneStatus, activity: string): ZoneStatus {
  if (zone === "thinking" || zone === "applying") return zone;
  if (activity === "connecting") return "thinking";
  return zone;
}

// Estimate the post-edit range after replacing `range.from..range.to` with
// `text`. ProseMirror counts characters (text) and structural transitions
// (1 per node boundary); for inline replacement within a paragraph this is
// roughly text length + small constant. Good enough for anchoring the surface
// and for "shorter / longer" voice navigation against the transformed range.
function computePostEditRange(
  range: { from: number; to: number } | null,
  text: string,
): { from: number; to: number } {
  if (!range) {
    return { from: 0, to: text.length };
  }
  // Rough: assume length ~= text.length within a paragraph; for multi-block
  // inserts the editor's actual selection.head will be more accurate.
  // The editor's replaceSelection will set selection.head to end-of-insert,
  // but we don't capture that here. This estimate is fine for surface-anchor
  // purposes; voice "shorter" still works because we always replace `range`.
  return { from: range.from, to: range.from + text.length };
}

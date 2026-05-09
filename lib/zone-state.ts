// Combined-hover state machine for the talk-zone gesture.
//
// Two zones (anchor + selection) share state — hovering EITHER opens a turn,
// leaving BOTH (with a 250ms grace window) closes it. The grace window absorbs
// micro-movements and the cursor-warp from one zone to the other.
//
// State machine transitions:
//   idle           → listening    on first zone-enter (any zone)
//   listening      → grace        on last zone-leave (started timer)
//   grace          → listening    on re-enter inside grace window
//   grace          → thinking     on grace timer expiry (commit turn)
//   thinking       → applying     when first tool call lands
//   applying       → idle         when tool flow finishes (no more pending)
//
// `thinking` and `applying` are LOCKED — re-hovers are ignored until idle.
//
// Window blur acts like a hard zone-leave (skips grace). Empty-buffer commits
// (no audio captured) discard the turn instead of triggering a response.

import { useEffect, useRef, useState } from "react";

export type ZoneId = "anchor" | "selection";
export type ZoneStatus = "idle" | "listening" | "grace" | "thinking" | "applying";

export interface ZoneStateSnapshot {
  status: ZoneStatus;
  hoveredZones: ReadonlySet<ZoneId>;
  capturedAnyAudio: boolean;
  isLocked: boolean;
}

export interface ZoneStateCallbacks {
  onTurnOpen: () => void; // hover-enter while idle: open turn (snapshot, send context, startCapture)
  onTurnCommit: () => void; // grace expired with audio: stopCapture (auto-commits + response.create)
  onTurnDiscard: () => void; // grace expired with no audio: stopCapture but no response — silent
  onLockChange?: (isLocked: boolean) => void;
}

export interface ZoneStateController {
  snapshot: ZoneStateSnapshot;
  enter: (zone: ZoneId) => void;
  leave: (zone: ZoneId) => void;
  // Audio reporting (the realtime layer calls this when audio buffer activity is detected)
  reportAudioActivity: () => void;
  // Tool-call lifecycle hooks (the realtime layer drives these)
  setStatus: (status: ZoneStatus) => void;
  reset: () => void;
}

const GRACE_MS = 250;

export function createZoneState(callbacks: ZoneStateCallbacks): ZoneStateController {
  let status: ZoneStatus = "idle";
  let hoveredZones = new Set<ZoneId>();
  let capturedAnyAudio = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const subscribers = new Set<(s: ZoneStateSnapshot) => void>();

  function isLocked(): boolean {
    return status === "thinking" || status === "applying";
  }

  function emit() {
    const snap = snapshot();
    for (const sub of subscribers) sub(snap);
  }

  function snapshot(): ZoneStateSnapshot {
    return {
      status,
      hoveredZones: new Set(hoveredZones),
      capturedAnyAudio,
      isLocked: isLocked(),
    };
  }

  function clearGrace() {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  }

  function enter(zone: ZoneId) {
    if (isLocked()) return; // ignore re-hover during thinking/applying
    const wasEmpty = hoveredZones.size === 0;
    hoveredZones.add(zone);

    if (status === "grace") {
      clearGrace();
      status = "listening";
      emit();
      return;
    }

    if (wasEmpty && status === "idle") {
      capturedAnyAudio = false;
      status = "listening";
      callbacks.onTurnOpen();
      emit();
    }
  }

  function leave(zone: ZoneId) {
    hoveredZones.delete(zone);
    if (hoveredZones.size > 0) {
      emit();
      return;
    }
    if (status !== "listening" && status !== "grace") {
      emit();
      return;
    }
    // Both zones empty — start grace.
    status = "grace";
    clearGrace();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // Commit only if we actually captured something.
      if (capturedAnyAudio) {
        status = "thinking";
        callbacks.onLockChange?.(true);
        callbacks.onTurnCommit();
      } else {
        status = "idle";
        callbacks.onTurnDiscard();
      }
      emit();
    }, GRACE_MS);
    emit();
  }

  function reportAudioActivity() {
    if (!capturedAnyAudio) {
      capturedAnyAudio = true;
      emit();
    }
  }

  function setStatus(next: ZoneStatus) {
    const prevLocked = isLocked();
    status = next;
    const nextLocked = isLocked();
    if (prevLocked !== nextLocked) {
      callbacks.onLockChange?.(nextLocked);
    }
    emit();
  }

  function reset() {
    clearGrace();
    status = "idle";
    hoveredZones = new Set();
    capturedAnyAudio = false;
    callbacks.onLockChange?.(false);
    emit();
  }

  // Window blur: treat as hard zone-leave and force commit/discard immediately.
  // Registered on attachWindow() (called from the React hook with cleanup).
  function onBlur() {
    if (hoveredZones.size === 0 && status !== "listening") return;
    hoveredZones.clear();
    clearGrace();
    if (status === "listening" || status === "grace") {
      if (capturedAnyAudio) {
        status = "thinking";
        callbacks.onLockChange?.(true);
        callbacks.onTurnCommit();
      } else {
        status = "idle";
        callbacks.onTurnDiscard();
      }
      emit();
    }
  }

  function attachWindow(): () => void {
    if (typeof window === "undefined") return () => undefined;
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }

  return {
    get snapshot() {
      return snapshot();
    },
    enter,
    leave,
    reportAudioActivity,
    setStatus,
    reset,
    // Internal: subscribe/unsubscribe — used by the React hook below.
    // Exposed via the `subscribe` symbol below.
    [SUBSCRIBE_SYMBOL]: (sub: (s: ZoneStateSnapshot) => void) => {
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    },
    [ATTACH_SYMBOL]: attachWindow,
  } as ZoneStateController & {
    [SUBSCRIBE_SYMBOL]: (sub: (s: ZoneStateSnapshot) => void) => () => void;
    [ATTACH_SYMBOL]: () => () => void;
  };
}

const SUBSCRIBE_SYMBOL = Symbol("voicemd-zone-state-subscribe");
const ATTACH_SYMBOL = Symbol("voicemd-zone-state-attach");

// React hook: builds a zone-state once and subscribes to it.
export function useZoneState(callbacks: ZoneStateCallbacks): {
  status: ZoneStatus;
  hoveredZones: ReadonlySet<ZoneId>;
  isLocked: boolean;
  enter: (zone: ZoneId) => void;
  leave: (zone: ZoneId) => void;
  reportAudioActivity: () => void;
  setStatus: (status: ZoneStatus) => void;
  reset: () => void;
} {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const controllerRef = useRef<ReturnType<typeof createZoneState> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createZoneState({
      onTurnOpen: () => callbacksRef.current.onTurnOpen(),
      onTurnCommit: () => callbacksRef.current.onTurnCommit(),
      onTurnDiscard: () => callbacksRef.current.onTurnDiscard(),
      onLockChange: (locked) => callbacksRef.current.onLockChange?.(locked),
    });
  }

  const [snap, setSnap] = useState<ZoneStateSnapshot>(
    () => controllerRef.current!.snapshot,
  );

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    type WithInternals = typeof controller & {
      [SUBSCRIBE_SYMBOL]: (sub: (s: ZoneStateSnapshot) => void) => () => void;
      [ATTACH_SYMBOL]: () => () => void;
    };
    const c = controller as WithInternals;
    const unsubscribe = c[SUBSCRIBE_SYMBOL]((s) => setSnap(s));
    const detach = c[ATTACH_SYMBOL]();
    return () => {
      unsubscribe();
      detach();
    };
  }, []);

  const c = controllerRef.current!;
  return {
    status: snap.status,
    hoveredZones: snap.hoveredZones,
    isLocked: snap.isLocked,
    enter: c.enter,
    leave: c.leave,
    reportAudioActivity: c.reportAudioActivity,
    setStatus: c.setStatus,
    reset: c.reset,
  };
}

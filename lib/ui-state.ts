// Shared UI state: last-transform memory + active A2UI surface.
// A tiny pub/sub store with a React hook for subscriptions.

import { useEffect, useRef, useState } from "react";
import type { SurfaceSpec } from "./tools";

export interface LastTransform {
  // The range that was replaced (in the post-edit doc).
  range: { from: number; to: number };
  // Anchor rect for the surface (selection rect at hover-enter).
  anchorRect: DOMRect | null;
  intent: string;
  // The original text, in case the user navigates "shorter" against a dial
  // and we want to know what was originally selected.
  originalText: string;
  // The currently-displayed text (updated as the user navigates the surface).
  currentText: string;
  // The selection bounds at the time of the original transform (used as the
  // canonical replacement range when navigating a dial — we replace whatever
  // is between these, even after the doc has shifted).
  // (`range` is updated by the editor whenever an edit lands; this is the
  // initial pre-Stage-1 bounds.)
}

export interface ActiveSurface {
  surfaceId: string;
  spec: SurfaceSpec;
  anchorRect: DOMRect | null;
  // Currently-selected tick per axis (for dials), or selected option index
  // (for cards), or just `null` (for chips).
  axisSelections?: Record<string, string>;
  // For voice control: what the user just said maps to one of these.
}

export interface UIStateSnapshot {
  lastTransform: LastTransform | null;
  activeSurface: ActiveSurface | null;
}

type Listener = (s: UIStateSnapshot) => void;

class UIStateStore {
  #snapshot: UIStateSnapshot = { lastTransform: null, activeSurface: null };
  #listeners = new Set<Listener>();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #escListener: ((e: KeyboardEvent) => void) | null = null;

  get snapshot(): UIStateSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  setLastTransform(t: LastTransform | null) {
    this.#snapshot = { ...this.#snapshot, lastTransform: t };
    this.#emit();
  }

  showSurface(surface: Omit<ActiveSurface, "surfaceId"> & { surfaceId?: string }) {
    const surfaceId = surface.surfaceId ?? `surface-${Date.now()}`;
    this.#snapshot = {
      ...this.#snapshot,
      activeSurface: {
        surfaceId,
        spec: surface.spec,
        anchorRect: surface.anchorRect,
        axisSelections: surface.axisSelections,
      },
    };
    this.#armIdleDismissal();
    this.#armEscDismissal();
    this.#emit();
  }

  updateSurfaceAxis(axisId: string, tickLabel: string) {
    const cur = this.#snapshot.activeSurface;
    if (!cur) return;
    const axisSelections = { ...(cur.axisSelections ?? {}), [axisId]: tickLabel };
    this.#snapshot = {
      ...this.#snapshot,
      activeSurface: { ...cur, axisSelections },
    };
    this.#armIdleDismissal();
    this.#emit();
  }

  dismissSurface() {
    if (!this.#snapshot.activeSurface) return;
    this.#snapshot = { ...this.#snapshot, activeSurface: null };
    this.#clearIdleDismissal();
    this.#clearEscDismissal();
    this.#emit();
  }

  // Bumps the 10s idle timer.
  bumpIdle() {
    if (!this.#snapshot.activeSurface) return;
    this.#armIdleDismissal();
  }

  #armIdleDismissal() {
    this.#clearIdleDismissal();
    if (typeof window === "undefined") return;
    this.#idleTimer = setTimeout(() => this.dismissSurface(), 10_000);
  }

  #clearIdleDismissal() {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  #armEscDismissal() {
    if (typeof window === "undefined") return;
    if (this.#escListener) return;
    this.#escListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.dismissSurface();
    };
    window.addEventListener("keydown", this.#escListener);
  }

  #clearEscDismissal() {
    if (typeof window === "undefined") return;
    if (!this.#escListener) return;
    window.removeEventListener("keydown", this.#escListener);
    this.#escListener = null;
  }
}

// Single shared store. (App-scoped; mounted once.)
export const uiStore = new UIStateStore();

export function useUIState(): UIStateSnapshot {
  const [snap, setSnap] = useState<UIStateSnapshot>(uiStore.snapshot);
  const listenerRef = useRef<Listener>(setSnap);
  listenerRef.current = setSnap;
  useEffect(() => {
    return uiStore.subscribe((s) => listenerRef.current(s));
  }, []);
  return snap;
}

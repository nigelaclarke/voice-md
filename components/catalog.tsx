"use client";

// catalog.tsx — the three affordance primitives. Each is small and renders
// from a typed spec in lib/tools.ts. The "catalog" is just the union of
// these spec types; new affordances are a new spec variant + a new branch in
// surface.tsx::renderSurface.
//
// Note: the brief proposed routing through @a2ui/react's MessageProcessor.
// We chose to render directly from the model-emitted spec instead, because
// the model already emits a flat, schema-validated payload (per the renderUI
// tool's Zod schema) and the streaming/healing benefits of A2UI don't
// matter when the spec ships in a single tool call. A2UI integration remains
// possible — it would slot in below renderSurface — but isn't on the
// hackathon path.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardsSpec, ChipSpec, DialSpec } from "@/lib/tools";

interface BaseProps {
  onApply: (markdown: string) => void;
  onDismiss: () => void;
}

// ---- Dial ---------------------------------------------------------------

interface DialProps extends BaseProps {
  spec: DialSpec;
  axisSelections: Record<string, string>;
  onAxisChange: (axisId: string, tickLabel: string) => void;
}

export function Dial({ spec, axisSelections, onApply, onAxisChange }: DialProps) {
  return (
    <div className="flex min-w-[22rem] flex-col gap-3 px-1 py-2">
      {spec.axes.map((axis) => (
        <DialAxis
          key={axis.id}
          axis={axis}
          values={spec.values[axis.id] ?? {}}
          currentTick={axisSelections[axis.id] ?? null}
          onApply={onApply}
          onAxisChange={(tick) => onAxisChange(axis.id, tick)}
        />
      ))}
    </div>
  );
}

interface DialAxisProps {
  axis: DialSpec["axes"][number];
  values: Record<string, string>;
  currentTick: string | null;
  onApply: (markdown: string) => void;
  onAxisChange: (tickLabel: string) => void;
}

function DialAxis({
  axis,
  values,
  currentTick,
  onApply,
  onAxisChange,
}: DialAxisProps) {
  const ticks = axis.ticks;
  const middleIndex = Math.floor(ticks.length / 2);
  const resolvedCurrent = currentTick ?? ticks[middleIndex];
  const resolvedIndex = Math.max(0, ticks.indexOf(resolvedCurrent));

  // Track DOM ref for hit-testing pointer events.
  const trackRef = useRef<HTMLDivElement>(null);

  // While dragging, we render the thumb at a free position along the track
  // (not snapped). The doc updates LIVE — every time the candidate tick index
  // changes during drag we call onApply with that tick's variant. The
  // already-applied index is tracked here so we don't fire onApply on every
  // pixel of pointermove (only when the snap-to tick actually changes).
  const [drag, setDrag] = useState<{
    pct: number;
    candidateIndex: number;
  } | null>(null);
  const lastAppliedIndexRef = useRef<number>(resolvedIndex);

  // Apply a tick's variant if it differs from the most recently applied one.
  const applyTickIfChanged = useCallback(
    (index: number) => {
      if (index === lastAppliedIndexRef.current) return;
      const tick = ticks[index];
      if (!tick) return;
      lastAppliedIndexRef.current = index;
      onAxisChange(tick);
      const variant = values[tick];
      if (variant) onApply(variant);
    },
    [ticks, values, onAxisChange, onApply],
  );

  // Keep `lastAppliedIndexRef` in sync with parent-driven changes (e.g. voice
  // navigation flipping the tick) so a follow-up drag from the same dot
  // doesn't re-apply the already-applied variant.
  useEffect(() => {
    lastAppliedIndexRef.current = resolvedIndex;
  }, [resolvedIndex]);

  // Lookup that converts a clientX (event coord) into a [0..1] position along
  // the track and the tick index closest to it.
  const computeFromClientX = useCallback(
    (clientX: number): { pct: number; index: number } | null => {
      const el = trackRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      const index = Math.round(pct * (ticks.length - 1));
      return { pct, index };
    },
    [ticks.length],
  );

  // Start drag on the thumb OR on the track (so a click on the track also
  // works). pointerdown captures the pointer to the element so subsequent
  // moves outside the track still fire on us. Apply immediately if the
  // pointer landed on a different tick than the current one.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      const result = computeFromClientX(e.clientX);
      if (!result) return;
      setDrag({ pct: result.pct * 100, candidateIndex: result.index });
      applyTickIfChanged(result.index);
    },
    [computeFromClientX, applyTickIfChanged],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const result = computeFromClientX(e.clientX);
      if (!result) return;
      setDrag({ pct: result.pct * 100, candidateIndex: result.index });
      // Apply live as the candidate tick crosses tick boundaries — gives the
      // dial a tactile, immediate feel rather than waiting for release.
      applyTickIfChanged(result.index);
    },
    [drag, computeFromClientX, applyTickIfChanged],
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const el = trackRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      // Final ensure-apply (in case pointerup happened without a move).
      applyTickIfChanged(drag.candidateIndex);
      setDrag(null);
    },
    [drag, applyTickIfChanged],
  );

  // Keyboard support — Left/Right arrow keys on the focused thumb step
  // through ticks.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next = resolvedIndex;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        next = Math.max(0, resolvedIndex - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        next = Math.min(ticks.length - 1, resolvedIndex + 1);
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = ticks.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      const tick = ticks[next];
      if (!tick || next === resolvedIndex) return;
      onAxisChange(tick);
      const variant = values[tick];
      if (variant) onApply(variant);
    },
    [resolvedIndex, ticks, onAxisChange, values, onApply],
  );

  // Position of the visible thumb. While dragging we use the free pct;
  // otherwise we snap to the current tick.
  const thumbPct = useMemo(() => {
    if (drag) return drag.pct;
    if (ticks.length <= 1) return 50;
    return (resolvedIndex / (ticks.length - 1)) * 100;
  }, [drag, resolvedIndex, ticks.length]);

  // While dragging, the candidate tick is what'll be applied on release.
  const candidateTick = drag
    ? (ticks[drag.candidateIndex] ?? resolvedCurrent)
    : resolvedCurrent;

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium uppercase tracking-wider text-[var(--color-muted)]">
          {axis.label}
        </span>
        <span className="font-medium text-[var(--color-foreground)]">
          {candidateTick}
        </span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={ticks.length - 1}
        aria-valuenow={resolvedIndex}
        aria-valuetext={resolvedCurrent}
        aria-label={axis.label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={onKeyDown}
        className="relative h-9 cursor-pointer touch-none focus:outline-none"
      >
        {/* Track */}
        <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--color-border)]" />
        {/* Filled portion up to thumb */}
        <div
          className={
            "pointer-events-none absolute left-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-emerald-400/70 " +
            (drag ? "" : "transition-[width] duration-150")
          }
          style={{ width: `calc((100% - 1rem) * ${thumbPct / 100})` }}
        />
        {/* Tick dots — visual only, hits go to the track */}
        <div className="pointer-events-none absolute inset-x-2 top-0 flex h-full items-center justify-between">
          {ticks.map((tick, i) => {
            const isCandidate = i === (drag?.candidateIndex ?? resolvedIndex);
            return (
              <span
                key={tick}
                className={
                  "block rounded-full border-2 transition-all " +
                  (isCandidate
                    ? "h-2.5 w-2.5 border-emerald-500/60 bg-emerald-400/40"
                    : "h-2 w-2 border-[var(--color-border)] bg-[var(--color-background)]")
                }
              />
            );
          })}
        </div>
        {/* Draggable thumb */}
        <span
          className={
            "pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-500 bg-emerald-400 shadow-md shadow-emerald-400/40 " +
            (drag
              ? "scale-110 ring-4 ring-emerald-400/30"
              : "transition-[left] duration-150")
          }
          style={{
            left: `calc(0.5rem + (100% - 1rem) * ${thumbPct / 100})`,
          }}
        />
      </div>
      {/* Tick labels under track — also clickable to snap directly. */}
      <div className="flex justify-between px-1 text-[10px] text-[var(--color-muted)]">
        {ticks.map((tick) => (
          <button
            key={tick}
            type="button"
            onClick={() => {
              onAxisChange(tick);
              const variant = values[tick];
              if (variant) onApply(variant);
            }}
            className={
              "max-w-[7ch] truncate rounded px-1 py-0.5 transition-colors hover:text-[var(--color-foreground)] " +
              (tick === candidateTick
                ? "font-medium text-[var(--color-foreground)]"
                : "")
            }
          >
            {tick}
          </button>
        ))}
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- AlternativeCards ----------------------------------------------------

interface CardsProps {
  spec: CardsSpec;
  // Apply the variant without committing (used for hover-preview).
  onPreview: (markdown: string) => void;
  // Apply and commit (used for click). The surface owner typically dismisses
  // the cards after this.
  onCommit: (markdown: string) => void;
  // Used internally for the click-outside-to-dismiss behaviour.
  onDismiss: () => void;
  // Whatever was applied to the doc immediately before the cards opened.
  // The cards revert to this when the cursor leaves the cards area without
  // clicking (so the doc isn't left showing a half-considered preview).
  baseline: string | null;
}

export function AlternativeCards({
  spec,
  onPreview,
  onCommit,
  onDismiss,
  baseline,
}: CardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Click outside dismisses. (We also revert any active preview on the way
  // out — see the unmount cleanup below.)
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Defer so the open click doesn't immediately close.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [onDismiss]);

  // If the cards unmount with a preview still in place (e.g. dismissed via
  // Esc, idle timeout, or click-outside), revert the doc to the baseline so
  // we don't strand the user on a variant they were only previewing. We use
  // refs to keep the cleanup independent of the latest closure.
  const previewActiveRef = useRef(false);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  useEffect(() => {
    return () => {
      if (previewActiveRef.current && baselineRef.current !== null) {
        onPreviewRef.current(baselineRef.current);
      }
    };
  }, []);

  const handleEnter = (full: string) => {
    if (baseline === null || full === baseline) return;
    previewActiveRef.current = true;
    onPreview(full);
  };

  const handleContainerLeave = () => {
    setHoveredIndex(null);
    if (previewActiveRef.current && baseline !== null) {
      previewActiveRef.current = false;
      onPreview(baseline);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1.5"
      onMouseLeave={handleContainerLeave}
    >
      {spec.options.map((opt, i) => {
        const isHovered = hoveredIndex === i;
        return (
          <button
            key={i}
            type="button"
            onMouseEnter={() => {
              setHoveredIndex(i);
              handleEnter(opt.full);
            }}
            onClick={() => {
              // Click takes effect — preview is now the committed value, so
              // we don't want the unmount cleanup to revert it.
              previewActiveRef.current = false;
              onCommit(opt.full);
            }}
            className={
              "flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors " +
              (isHovered
                ? "border-emerald-400/70 bg-emerald-400/10 shadow-sm"
                : "border-[var(--color-border)] bg-[var(--color-background)] hover:border-emerald-400/60 hover:bg-emerald-400/5")
            }
          >
            <span className="font-medium text-[var(--color-foreground)]">
              {opt.label}
              {isHovered ? (
                <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  preview
                </span>
              ) : null}
            </span>
            <span className="line-clamp-2 text-[var(--color-muted)]">
              {opt.preview}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Chip ----------------------------------------------------------------

interface ChipProps {
  spec: ChipSpec;
  onFollowup: (instruction: string) => void;
  onDismiss: () => void;
}

export function Chip({ spec, onFollowup }: ChipProps) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setActive(true);
        onFollowup(spec.followup);
      }}
      disabled={active}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (active
          ? "border-emerald-400/60 bg-emerald-400/15 text-[var(--color-foreground)]"
          : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted)] hover:border-emerald-400/40 hover:bg-emerald-400/10")
      }
    >
      {active ? "thinking…" : spec.label}
    </button>
  );
}

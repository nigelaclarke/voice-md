"use client";

// catalog.tsx — the three affordance primitives. Each is small and renders
// from a typed spec in lib/tools.ts. Visuals follow the paper-aesthetic
// design (Newsreader serif previews, linear ticked dial, mono micro-labels,
// muted coral as the only "live" accent).

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

export function Dial({
  spec,
  axisSelections,
  onApply,
  onAxisChange,
  onDismiss,
}: DialProps) {
  return (
    <div className="dial">
      {spec.axes.map((axis, idx) => (
        <div key={axis.id} className="dial-row">
          <DialAxis
            axis={axis}
            values={spec.values[axis.id] ?? {}}
            currentTick={axisSelections[axis.id] ?? null}
            showClose={idx === 0}
            onApply={onApply}
            onAxisChange={(tick) => onAxisChange(axis.id, tick)}
            onDismiss={onDismiss}
          />
        </div>
      ))}
    </div>
  );
}

interface DialAxisProps {
  axis: DialSpec["axes"][number];
  values: Record<string, string>;
  currentTick: string | null;
  showClose: boolean;
  onApply: (markdown: string) => void;
  onAxisChange: (tickLabel: string) => void;
  onDismiss: () => void;
}

function DialAxis({
  axis,
  values,
  currentTick,
  showClose,
  onApply,
  onAxisChange,
  onDismiss,
}: DialAxisProps) {
  const ticks = axis.ticks;
  const middleIndex = Math.floor(ticks.length / 2);
  const resolvedCurrent = currentTick ?? ticks[middleIndex];
  const resolvedIndex = Math.max(0, ticks.indexOf(resolvedCurrent));

  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    pct: number;
    candidateIndex: number;
  } | null>(null);
  const lastAppliedIndexRef = useRef<number>(resolvedIndex);

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

  // Keep `lastAppliedIndexRef` synced with parent-driven changes.
  useEffect(() => {
    lastAppliedIndexRef.current = resolvedIndex;
  }, [resolvedIndex]);

  const computeFromClientX = useCallback(
    (clientX: number): { pct: number; index: number } | null => {
      const el = trackRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const pad = 4; // visual padding inside track (matches .line left/right)
      const usable = rect.width - pad * 2;
      if (usable <= 0) return null;
      let x = clientX - rect.left - pad;
      x = Math.max(0, Math.min(usable, x));
      const pct = x / usable;
      const index = Math.round(pct * (ticks.length - 1));
      return { pct, index };
    },
    [ticks.length],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      const result = computeFromClientX(e.clientX);
      if (!result) return;
      setDrag({ pct: result.pct, candidateIndex: result.index });
      applyTickIfChanged(result.index);
    },
    [computeFromClientX, applyTickIfChanged],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const result = computeFromClientX(e.clientX);
      if (!result) return;
      setDrag({ pct: result.pct, candidateIndex: result.index });
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
      applyTickIfChanged(drag.candidateIndex);
      setDrag(null);
    },
    [drag, applyTickIfChanged],
  );

  // Knob / fill position uses pct directly while dragging; otherwise snaps.
  const thumbPct = useMemo(() => {
    if (drag) return drag.pct;
    if (ticks.length <= 1) return 0.5;
    return resolvedIndex / (ticks.length - 1);
  }, [drag, resolvedIndex, ticks.length]);

  const candidateIndex = drag?.candidateIndex ?? resolvedIndex;

  return (
    <>
      <div className="head">
        <span className="axis">{axis.label}</span>
        {showClose && (
          <button className="x" onClick={onDismiss} aria-label="dismiss">
            esc
          </button>
        )}
      </div>
      <div
        ref={trackRef}
        className={"track" + (drag ? " dragging" : "")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className="line" />
        {ticks.map((_tick, i) => (
          <div
            key={i}
            className={
              "tick" +
              (i === 1 && ticks.length === 3 ? " mid" : "") +
              (i === Math.floor(ticks.length / 2) && ticks.length > 3
                ? " mid"
                : "")
            }
            style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
          />
        ))}
        <div
          className="knob"
          style={{ left: `${thumbPct * 100}%` }}
        />
      </div>
      <div className="labels">
        {ticks.map((tick, i) => (
          <button
            key={tick}
            type="button"
            className={i === candidateIndex ? "active" : ""}
            onClick={() => {
              onAxisChange(tick);
              const variant = values[tick];
              if (variant) onApply(variant);
            }}
          >
            {tick}
          </button>
        ))}
      </div>
    </>
  );
}

// ---- AlternativeCards ----------------------------------------------------

interface CardsProps {
  spec: CardsSpec;
  onPreview: (markdown: string) => void;
  onCommit: (markdown: string) => void;
  onDismiss: () => void;
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

  // Click outside dismisses.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [onDismiss]);

  // Revert preview to baseline on unmount.
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

  const handleEnter = (index: number, full: string) => {
    setHoveredIndex(index);
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
      className="cards"
      onMouseLeave={handleContainerLeave}
    >
      <div className="head">
        <span>{spec.options.length} reading{spec.options.length === 1 ? "" : "s"}</span>
        <button onClick={onDismiss} aria-label="dismiss">esc</button>
      </div>
      {spec.options.map((opt, i) => (
        <button
          key={i}
          type="button"
          className={"card" + (hoveredIndex === i ? " active" : "")}
          onMouseEnter={() => handleEnter(i, opt.full)}
          onClick={() => {
            previewActiveRef.current = false;
            onCommit(opt.full);
          }}
        >
          <div className="lab">{opt.label}</div>
          <div className="preview">{opt.preview}</div>
        </button>
      ))}
    </div>
  );
}

// ---- Chip ----------------------------------------------------------------

interface ChipProps {
  spec: ChipSpec;
  onFollowup: (instruction: string) => void;
  onDismiss: () => void;
}

export function Chip({ spec, onFollowup, onDismiss }: ChipProps) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className="suggestion"
      onClick={() => {
        if (active) return;
        setActive(true);
        onFollowup(spec.followup);
      }}
      disabled={active}
    >
      <span className="plus">+</span>
      <span>{active ? "thinking…" : spec.label}</span>
      <span
        className="x"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        role="button"
        aria-label="dismiss"
      >
        ✕
      </span>
    </button>
  );
}

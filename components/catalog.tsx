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

import { useState, useRef, useEffect } from "react";
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
  // Pick: middle tick is the default (matches what shipped in Stage 1).
  const middleIndex = (ticks: string[]) => Math.floor(ticks.length / 2);

  return (
    <div className="flex flex-col gap-2">
      {spec.axes.map((axis) => {
        const currentTick =
          axisSelections[axis.id] ?? axis.ticks[middleIndex(axis.ticks)];
        return (
          <div key={axis.id} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-[var(--color-muted)]">
              {axis.label}
            </span>
            <div className="flex flex-1 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5">
              {axis.ticks.map((tick) => {
                const isSelected = tick === currentTick;
                return (
                  <button
                    key={tick}
                    type="button"
                    onClick={() => {
                      onAxisChange(axis.id, tick);
                      const variant = spec.values[axis.id]?.[tick];
                      if (variant) onApply(variant);
                    }}
                    className={
                      "rounded-full px-2 py-0.5 transition-colors " +
                      (isSelected
                        ? "bg-emerald-400/20 font-medium text-[var(--color-foreground)]"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)]")
                    }
                  >
                    {tick}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- AlternativeCards ----------------------------------------------------

interface CardsProps extends BaseProps {
  spec: CardsSpec;
}

export function AlternativeCards({ spec, onApply, onDismiss }: CardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside dismisses.
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

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      {spec.options.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onApply(opt.full)}
          className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-left text-xs transition-colors hover:border-emerald-400/60 hover:bg-emerald-400/5"
        >
          <span className="font-medium text-[var(--color-foreground)]">
            {opt.label}
          </span>
          <span className="line-clamp-2 text-[var(--color-muted)]">
            {opt.preview}
          </span>
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

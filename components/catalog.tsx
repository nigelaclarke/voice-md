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
    <div className="flex min-w-[22rem] flex-col gap-3 px-1 py-2">
      {spec.axes.map((axis) => {
        const currentTick =
          axisSelections[axis.id] ?? axis.ticks[middleIndex(axis.ticks)];
        const currentIndex = Math.max(0, axis.ticks.indexOf(currentTick));
        const ticks = axis.ticks;
        // Position the dot as a percentage along the track based on the tick
        // index. With N ticks, tick i sits at i/(N-1) of the track.
        const dotPct =
          ticks.length > 1 ? (currentIndex / (ticks.length - 1)) * 100 : 50;
        return (
          <div key={axis.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-medium uppercase tracking-wider text-[var(--color-muted)]">
                {axis.label}
              </span>
              <span className="font-medium text-[var(--color-foreground)]">
                {currentTick}
              </span>
            </div>
            <div className="relative h-9">
              {/* Track */}
              <div className="absolute left-2 right-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--color-border)]" />
              {/* Filled portion up to current */}
              <div
                className="absolute left-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-emerald-400/70 transition-all"
                style={{
                  width: `calc((100% - 1rem) * ${dotPct / 100})`,
                }}
              />
              {/* Tick buttons */}
              <div className="absolute inset-x-2 top-0 flex h-full items-center justify-between">
                {ticks.map((tick) => {
                  const isSelected = tick === currentTick;
                  return (
                    <button
                      key={tick}
                      type="button"
                      title={tick}
                      onClick={() => {
                        onAxisChange(axis.id, tick);
                        const variant = spec.values[axis.id]?.[tick];
                        if (variant) onApply(variant);
                      }}
                      className={
                        "group relative flex h-9 w-9 items-center justify-center transition-transform hover:scale-110"
                      }
                    >
                      <span
                        className={
                          "block rounded-full border-2 transition-all " +
                          (isSelected
                            ? "h-4 w-4 border-emerald-500 bg-emerald-400 shadow-md shadow-emerald-400/40"
                            : "h-2.5 w-2.5 border-[var(--color-border)] bg-[var(--color-background)] group-hover:border-emerald-400/60")
                        }
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Tick labels under track */}
            <div className="flex justify-between px-2 text-[10px] text-[var(--color-muted)]">
              {ticks.map((tick) => (
                <button
                  key={tick}
                  type="button"
                  onClick={() => {
                    onAxisChange(axis.id, tick);
                    const variant = spec.values[axis.id]?.[tick];
                    if (variant) onApply(variant);
                  }}
                  className={
                    "max-w-[7ch] truncate rounded px-1 py-0.5 transition-colors hover:text-[var(--color-foreground)] " +
                    (tick === currentTick
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

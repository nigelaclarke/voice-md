"use client";

// surface.tsx — host for the active affordance, anchored to the just-edited
// selection rect. Renders one of three component variants from the
// model-emitted SurfaceSpec.

import { useEffect, useRef, useState, type RefObject } from "react";

import { AlternativeCards, Chip, Dial } from "@/components/catalog";
import type { EditorHandle } from "@/components/editor";
import { uiStore, useUIState } from "@/lib/ui-state";
import type { SurfaceSpec } from "@/lib/tools";

interface SurfaceProps {
  editorRef: RefObject<EditorHandle | null>;
  onAnyInteraction?: () => void;
  onChipFollowup: (instruction: string) => void;
}

export function Surface({
  editorRef,
  onAnyInteraction,
  onChipFollowup,
}: SurfaceProps) {
  const ui = useUIState();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Log surface lifecycle so we can confirm renderUI tool calls actually
  // mount the affordance (and at what position).
  useEffect(() => {
    if (ui.activeSurface) {
      console.info(
        "[voice:surface] mounted",
        ui.activeSurface.surfaceId,
        "type=" + ui.activeSurface.spec.type,
      );
      return () => {
        console.info(
          "[voice:surface] unmounted",
          ui.activeSurface?.surfaceId ?? "?",
        );
      };
    }
  }, [ui.activeSurface]);

  // Position the surface beneath the just-edited range. Re-measure on scroll
  // and on doc changes so it tracks if the user keeps editing.
  useEffect(() => {
    if (!ui.activeSurface) {
      setPosition(null);
      return;
    }
    const measure = () => {
      const handle = editorRef.current;
      const lt = uiStore.snapshot.lastTransform;
      let rect: DOMRect | null = null;
      let source = "fallback-default";
      if (handle && lt) {
        rect = handle.getRangeRect(lt.range.from, lt.range.to);
        if (rect) source = "lastTransform.range";
      }
      if (!rect) {
        rect = ui.activeSurface?.anchorRect ?? null;
        if (rect) source = "anchorRect";
      }
      if (!rect) {
        console.warn(
          "[voice:surface] no anchor rect — using viewport fallback (80, 80)",
        );
        setPosition({ top: 80, left: 80 });
        return;
      }
      const padding = 8;
      const surfaceWidth = wrapperRef.current?.offsetWidth ?? 320;
      const left = Math.max(
        16,
        Math.min(window.innerWidth - surfaceWidth - 16, rect.left),
      );
      const top = rect.bottom + padding;
      console.info("[voice:surface] positioned via " + source, {
        top: Math.round(top),
        left: Math.round(left),
      });
      setPosition({ top, left });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [ui.activeSurface, editorRef]);

  if (!ui.activeSurface || !position) return null;

  const { spec, axisSelections } = ui.activeSurface;

  const apply = (markdown: string) => {
    onAnyInteraction?.();
    const handle = editorRef.current;
    const lt = uiStore.snapshot.lastTransform;
    if (!handle || !lt) return;
    console.info("[voice:surface] apply", {
      markdownLength: markdown.length,
      againstRange: lt.range,
    });
    const postRange = handle.replaceSelection(markdown, lt.range);
    // Use the actual post-edit range from the editor so subsequent variant
    // swaps target the right region (not an estimated length).
    uiStore.setLastTransform({
      ...lt,
      range: postRange ?? {
        from: lt.range.from,
        to: lt.range.from + markdown.length,
      },
      currentText: markdown,
    });
  };

  const dismiss = () => {
    console.info("[voice:surface] dismiss requested");
    uiStore.dismissSurface();
  };

  const renderInner = () => {
    switch (spec.type) {
      case "dial":
        return (
          <Dial
            spec={spec}
            axisSelections={axisSelections ?? {}}
            onApply={apply}
            onDismiss={dismiss}
            onAxisChange={(axisId, tick) =>
              uiStore.updateSurfaceAxis(axisId, tick)
            }
          />
        );
      case "cards":
        return (
          <AlternativeCards
            spec={spec}
            onApply={(md) => {
              apply(md);
              dismiss();
            }}
            onDismiss={dismiss}
          />
        );
      case "chip":
        return (
          <Chip
            spec={spec}
            onFollowup={(instruction) => {
              onAnyInteraction?.();
              onChipFollowup(instruction);
            }}
            onDismiss={dismiss}
          />
        );
      default: {
        const exhaustive: never = spec;
        void exhaustive;
        return null;
      }
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-auto fixed z-30 max-w-md min-w-[16rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/95 p-2 shadow-lg backdrop-blur"
      style={{ top: position.top, left: position.left }}
    >
      {renderInner()}
      <div className="mt-1 flex items-center justify-between border-t border-[var(--color-border)]/50 px-1 pt-1 text-[10px] text-[var(--color-muted)]">
        <span className="uppercase tracking-wider">{spec.type}</span>
        <button
          type="button"
          onClick={dismiss}
          className="rounded px-1.5 py-0.5 hover:bg-[var(--color-border)]/40"
          aria-label="Dismiss surface"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}

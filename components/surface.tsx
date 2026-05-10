"use client";

// surface.tsx — host for the active affordance, anchored to the just-edited
// selection rect. Renders one of three component variants from the
// model-emitted SurfaceSpec.

import { useEffect, useRef, useState, type RefObject } from "react";

import { AlternativeCards, Dial } from "@/components/catalog";
import type { EditorHandle } from "@/components/editor";
import { uiStore, useUIState } from "@/lib/ui-state";

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

  // Dismiss when the user clicks anywhere outside the surface — clicking the
  // page background (or the editor body, or the talk zone) means they're done
  // iterating. Uses mousedown capture so we react before in-DOM handlers, and
  // skips when wrapperRef isn't mounted yet (brief race during the first
  // render pass while position is being measured).
  useEffect(() => {
    if (!ui.activeSurface) return;
    const onMouseDown = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const target = e.target as Node | null;
      if (target && wrapper.contains(target)) return;
      console.info("[voice:surface] dismiss via outside click");
      uiStore.dismissSurface();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
    };
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
      case "cards": {
        // The "baseline" is whatever was in the doc when the cards opened —
        // i.e. the Stage-1 transformSelection output. We snapshot it from
        // the active surface's lifetime, NOT from the live lastTransform
        // (which gets mutated on every preview-apply).
        const baseline = ui.activeSurface?.cardsBaseline ?? null;
        return (
          <AlternativeCards
            spec={spec}
            baseline={baseline}
            onPreview={(md) => apply(md)}
            onCommit={(md) => {
              apply(md);
              dismiss();
            }}
            onDismiss={dismiss}
          />
        );
      }
      // chip is temporarily disabled — removed from surfaceSpec union in
      // lib/tools.ts. Restore both the union and this case to revive.
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
      className="surface entered"
      style={{ top: position.top, left: position.left, pointerEvents: "auto" }}
    >
      {renderInner()}
    </div>
  );
}

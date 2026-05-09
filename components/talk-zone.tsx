"use client";

// One component, two instances.
//   variant="anchor"    — fixed bottom-right, always visible, ~64x64
//   variant="selection" — floats next to the active selection, anchored
//                         to a DOMRect supplied by the editor handle.
// Both bind to the SAME enter(zone)/leave(zone) handlers — drift between
// them mid-thought without truncating the turn.

import { useEffect, useRef, useState } from "react";
import type { ZoneId, ZoneStatus } from "@/lib/zone-state";

interface BaseProps {
  status: ZoneStatus;
  isHovered: boolean;
  isLocked: boolean;
  onEnter: (zone: ZoneId) => void;
  onLeave: (zone: ZoneId) => void;
  onZoneRect?: (zone: ZoneId, rect: DOMRect | null) => void;
}

interface AnchorProps extends BaseProps {
  variant: "anchor";
}

interface SelectionProps extends BaseProps {
  variant: "selection";
  // Selection rect from the editor (post-flip-correction)
  anchorRect: DOMRect | null;
}

export type TalkZoneProps = AnchorProps | SelectionProps;

export function TalkZone(props: TalkZoneProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const zoneId: ZoneId = props.variant === "anchor" ? "anchor" : "selection";

  // Report own DOMRect for transcript chip anchoring.
  useEffect(() => {
    if (!props.onZoneRect) return;
    const el = ref.current;
    if (!el) {
      props.onZoneRect(zoneId, null);
      return;
    }
    const update = () => props.onZoneRect?.(zoneId, el.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // anchorRect change for selection variant triggers re-report via the
    // dependency below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zoneId,
    props.variant,
    props.variant === "selection" ? props.anchorRect : null,
  ]);

  const isActive = props.isHovered;
  const isListening = props.status === "listening" || props.status === "grace";

  // Position. Anchor: fixed bottom-right. Selection: computed from anchorRect.
  let style: React.CSSProperties;
  if (props.variant === "anchor") {
    style = { right: 24, bottom: 24, position: "fixed" };
  } else {
    style = computeSelectionPosition(props.anchorRect);
  }

  // Hide selection-zone if no rect or doc has no selection
  if (props.variant === "selection" && !props.anchorRect) {
    return null;
  }

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      data-zone={zoneId}
      data-active={isActive}
      data-status={props.status}
      aria-label={
        props.variant === "anchor"
          ? "Talk to VoiceMD (anchor)"
          : "Talk about the selection"
      }
      onPointerEnter={() => !props.isLocked && props.onEnter(zoneId)}
      onPointerLeave={() => props.onLeave(zoneId)}
      style={style}
      className={cn(
        "z-30 flex items-center justify-center rounded-full border transition-all duration-150",
        "focus:outline-none",
        props.variant === "anchor" ? "h-14 w-14" : "h-9 w-9",
        // Unhovered styling
        !isActive &&
          !isListening &&
          "border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur shadow-sm",
        !isActive && "hover:scale-105",
        // Hovered styling
        isActive &&
          "border-emerald-400/60 bg-emerald-400/15 shadow-emerald-400/30 shadow-md",
        // Listening glow
        isListening && "ring-2 ring-emerald-400/40",
        // Locked
        props.isLocked && "opacity-40 cursor-default",
        // Selection variant pulses gently when first appearing
        props.variant === "selection" && "animate-zone-appear",
      )}
    >
      <Mic listening={isListening} />
    </button>
  );
}

function Mic({ listening }: { listening: boolean }) {
  // Simple mic glyph + waveform overlay when listening.
  return (
    <span className="relative flex items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 text-zinc-500 transition-colors"
        style={listening ? { color: "rgb(16 185 129)" } : undefined}
      >
        <path d="M12 2v0a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 11a7 7 0 1 1-14 0" />
        <path d="M12 18v3" />
      </svg>
      {listening && (
        <span className="absolute inset-0 flex items-center justify-center gap-0.5">
          <span className="h-2 w-0.5 animate-wave bg-emerald-400" />
          <span className="h-3 w-0.5 animate-wave bg-emerald-400 [animation-delay:0.12s]" />
          <span className="h-2.5 w-0.5 animate-wave bg-emerald-400 [animation-delay:0.24s]" />
        </span>
      )}
    </span>
  );
}

function computeSelectionPosition(rect: DOMRect | null): React.CSSProperties {
  if (!rect) return { display: "none", position: "fixed" };

  const padding = 6;
  const zoneSize = 36; // matches h-9 w-9
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 768;

  // Default: below-right of the selection.
  let left = rect.right - zoneSize / 2;
  let top = rect.bottom + padding;

  // Flip below → above if there's no room below.
  if (top + zoneSize > viewportHeight - 16) {
    top = Math.max(8, rect.top - zoneSize - padding);
  }

  // Clamp horizontally.
  left = Math.max(8, Math.min(viewportWidth - zoneSize - 8, left));

  return { left, top, position: "fixed" };
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

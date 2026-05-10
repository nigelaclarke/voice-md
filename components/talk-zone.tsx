"use client";

// talk-zone.tsx — selection-following talk zone (single zone, paper aesthetic).
//
// Visual states (driven by .zone className):
//   idle       — dashed dotted ring; mono "talk" glyph
//   listening  — coral live ring + waveform bars
//   grace      — same as listening (cursor-warp window between zones, kept for
//                state-machine compatibility)
//   thinking   — solid ring + rotating arc
//   applying   — paper fill flash + coral live ring

import { useEffect, useRef } from "react";
import type { ZoneId, ZoneStatus } from "@/lib/zone-state";

export interface TalkZoneProps {
  status: ZoneStatus;
  isLocked: boolean;
  fresh?: boolean;
  showHint?: boolean;
  // Anchor rect supplied by the editor for the active selection.
  anchorRect: DOMRect | null;
  onEnter: (zone: ZoneId) => void;
  onLeave: (zone: ZoneId) => void;
  onZoneRect?: (zone: ZoneId, rect: DOMRect | null) => void;
}

export function TalkZone(props: TalkZoneProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const zoneId: ZoneId = "selection";

  // Report own DOMRect for transcript chip anchoring. Compute a stable string
  // key from the rect so we don't re-fire on identical-geometry DOMRect refs.
  const anchorKey = props.anchorRect
    ? `${props.anchorRect.left},${props.anchorRect.top},${props.anchorRect.width},${props.anchorRect.height}`
    : "no-rect";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  if (!props.anchorRect) return null;

  const { left, top } = computeSelectionPosition(props.anchorRect);

  // Zone state class drives the CSS choreography in globals.css.
  const stateClass = props.status; // 'idle' | 'listening' | 'grace' | 'thinking' | 'applying'

  return (
    <div className="sel-zone-wrap" style={{ left, top }}>
      <button
        ref={ref}
        type="button"
        tabIndex={-1}
        data-zone={zoneId}
        data-status={props.status}
        aria-label="Talk about the selection"
        onPointerEnter={() => !props.isLocked && props.onEnter(zoneId)}
        onPointerLeave={() => props.onLeave(zoneId)}
        className={
          "zone " +
          stateClass +
          (props.fresh ? " fresh" : "") +
          (props.isLocked ? " locked" : "")
        }
      >
        <div className="ring fill" />
        <div className="ring dashed" />
        <div className="ring solid" />
        <div className="ring live" />
        <div className="arc">
          <svg viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="15" stroke="var(--fg-4)" strokeOpacity="0.25" strokeWidth="1" />
            <path
              d="M 16 1 A 15 15 0 0 1 31 16"
              stroke="var(--fg)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="wave">
          <i /><i /><i /><i /><i />
        </div>
        {props.showHint !== false && <span className="glyph">talk</span>}
      </button>
    </div>
  );
}

// Position the selection zone BELOW the selection, with the zone's right
// edge aligned to the selection's right edge. The .doc reserves 96px right
// padding so this lands clear of the prose.
function computeSelectionPosition(rect: DOMRect): { left: number; top: number } {
  const zoneSize = 56; // matches --r-zone
  const padding = 8;
  const gap = 12;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;

  // Right edge of zone aligns with right edge of selection; zone sits gap
  // below the selection's bottom.
  let left = rect.right - zoneSize;
  let top = rect.bottom + gap;

  // Flip below → above if there's no room below.
  if (top + zoneSize > viewportHeight - 16) {
    top = Math.max(padding, rect.top - zoneSize - gap);
  }

  // Clamp horizontally.
  left = Math.max(padding, Math.min(viewportWidth - zoneSize - padding, left));

  return { left, top };
}

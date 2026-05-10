"use client";

interface TranscriptChipProps {
  text: string;
  visible: boolean;
  // Anchor rect — chip floats above-left of the active zone.
  anchorRect: DOMRect | null;
}

export function TranscriptChip({ text, visible, anchorRect }: TranscriptChipProps) {
  if (!visible || !text || !anchorRect) return null;

  // Chip sits above the zone with a small gap, and its right edge roughly
  // aligns with the zone's right edge so the chip extends leftward into the
  // doc's gutter rather than off-screen on narrow viewports.
  const chipMaxWidth = 320;
  const gap = 12;
  const chipApproxHeight = 32;
  const top = Math.max(8, anchorRect.top - chipApproxHeight - gap);
  const left = Math.max(8, anchorRect.right - chipMaxWidth);

  return (
    <div className="chip" style={{ top, left, maxWidth: chipMaxWidth }}>
      <span className="live-dot" />
      <span className="text">
        {text}
        <span className="caret" />
      </span>
    </div>
  );
}

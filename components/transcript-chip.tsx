"use client";

interface TranscriptChipProps {
  text: string;
  visible: boolean;
  // Anchor rect — chip floats above-left of the active zone.
  anchorRect: DOMRect | null;
}

export function TranscriptChip({ text, visible, anchorRect }: TranscriptChipProps) {
  if (!visible || !text || !anchorRect) return null;

  // Position above the anchor, right-aligned to it.
  const top = Math.max(8, anchorRect.top - 48);
  const left = Math.max(8, anchorRect.right - 320);

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-[20rem] truncate rounded-full border border-[var(--color-border)] bg-[var(--color-background)]/95 px-3 py-1.5 text-xs text-[var(--color-foreground)] shadow-md backdrop-blur"
      style={{ top, left }}
    >
      {text}
    </div>
  );
}

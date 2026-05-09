"use client";

import type { ZoneStatus } from "@/lib/zone-state";

const COPY: Record<ZoneStatus, string> = {
  idle: "ready",
  listening: "listening",
  grace: "listening",
  thinking: "thinking",
  applying: "applying",
};

const DOT: Record<ZoneStatus, string> = {
  idle: "bg-zinc-300 dark:bg-zinc-700",
  listening: "bg-emerald-400 animate-pulse",
  grace: "bg-emerald-400/70",
  thinking: "bg-amber-400 animate-pulse",
  applying: "bg-blue-400 animate-pulse",
};

interface StatusPillProps {
  status: ZoneStatus;
  connected: boolean;
}

export function StatusPill({ status, connected }: StatusPillProps) {
  // While the WebRTC session isn't established, we override the visible state
  // so the user sees the connection coming up rather than a misleading "ready".
  const copy = !connected ? "connecting" : COPY[status];
  const dot = !connected
    ? "bg-zinc-400 animate-pulse"
    : DOT[status];
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-background)]/85 px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] shadow-sm backdrop-blur"
      aria-live="polite"
      aria-label={`status: ${copy}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="tabular-nums tracking-wide">{copy}</span>
    </div>
  );
}

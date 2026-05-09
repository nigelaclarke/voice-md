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

export function StatusPill({ status }: { status: ZoneStatus }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-background)]/85 px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] shadow-sm backdrop-blur"
      aria-live="polite"
      aria-label={`status: ${COPY[status]}`}
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      <span className="tabular-nums tracking-wide">{COPY[status]}</span>
    </div>
  );
}

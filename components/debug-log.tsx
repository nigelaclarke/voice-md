"use client";

// Tiny in-app log overlay. Captures the last N console.* lines so you can
// see what's happening without opening DevTools. Toggle with the gear button.

import { useEffect, useState } from "react";

interface LogLine {
  level: "log" | "info" | "warn" | "error" | "debug";
  ts: number;
  msg: string;
}

const LIMIT = 80;

export function DebugLog() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    const wrap = (level: LogLine["level"]) =>
      (...args: unknown[]) => {
        // Only capture lines tagged with [voice or [voice:...] — keeps the
        // overlay focused on the voice loop instead of every fetch chatter.
        const first = args[0];
        if (typeof first === "string" && first.startsWith("[voice")) {
          const msg = args.map(stringifyForLog).join(" ");
          setLines((prev) => {
            const next = [...prev, { level, ts: Date.now(), msg }];
            return next.length > LIMIT ? next.slice(-LIMIT) : next;
          });
        }
        return original[level](...args);
      };

    console.log = wrap("log");
    console.info = wrap("info");
    console.warn = wrap("warn");
    console.error = wrap("error");
    console.debug = wrap("debug");

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Hide voice log" : "Show voice log"}
        className="pointer-events-auto fixed left-4 top-4 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/85 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)] backdrop-blur hover:bg-[var(--color-border)]/40"
        aria-label="Toggle voice debug log"
      >
        {open ? "hide log" : `log (${lines.length})`}
      </button>
      {open && (
        <div className="pointer-events-auto fixed left-4 top-12 z-40 max-h-[60vh] w-[28rem] max-w-[90vw] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/95 p-2 font-mono text-[11px] leading-relaxed text-[var(--color-foreground)] shadow-lg backdrop-blur">
          {lines.length === 0 ? (
            <span className="text-[var(--color-muted)]">no [voice:*] events yet — hover the talk zone</span>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={
                  "whitespace-pre-wrap break-all " +
                  (line.level === "error"
                    ? "text-rose-500"
                    : line.level === "warn"
                      ? "text-amber-500"
                      : line.level === "debug"
                        ? "text-[var(--color-muted)]"
                        : "")
                }
              >
                <span className="text-[var(--color-muted)]">
                  {fmtTime(line.ts)}{" "}
                </span>
                {line.msg}
              </div>
            ))
          )}
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => setLines([])}
              className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)] hover:bg-[var(--color-border)]/40"
            >
              clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function stringifyForLog(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  // Errors don't have own enumerable props, so JSON.stringify(err) === "{}".
  // Pull out the parts we care about explicitly.
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "object") {
    // Walk one level to lift any nested Error into a useful string.
    try {
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v instanceof Error) {
          flat[k] = `${v.name}: ${v.message}`;
        } else {
          flat[k] = v;
        }
      }
      const json = JSON.stringify(flat);
      if (json === "{}") {
        // Fall back to looking at non-enumerable props common on Error-likes.
        const e = value as { name?: unknown; message?: unknown; code?: unknown };
        if (e.name || e.message || e.code) {
          return `${e.name ?? "?"}: ${e.message ?? "(no message)"}${
            e.code ? ` (code=${String(e.code)})` : ""
          }`;
        }
      }
      return json;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

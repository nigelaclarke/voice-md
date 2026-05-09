"use client";

import type { VoiceControlError } from "realtime-voice-component";

interface ErrorBannerProps {
  error: VoiceControlError | null;
  onRetry: () => void;
}

const COPY: Partial<Record<NonNullable<VoiceControlError["code"]>, string>> = {
  permission_denied: "Microphone access was denied. Allow it in your browser, then click retry.",
  device_unavailable: "No microphone detected. Connect one and click retry.",
  insecure_context: "Voice requires HTTPS or localhost. Open the app on a secure origin.",
  network_error: "Lost the connection to the voice service. Click retry.",
  media_timeout: "The microphone took too long to start. Click retry.",
  unsupported_browser: "This browser doesn't support the voice runtime. Try a recent Chrome or Edge.",
  aborted: "The voice session was aborted. Click retry.",
  unknown: "Voice runtime hit an unknown error. Click retry.",
};

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  if (!error) return null;
  const message = (error.code && COPY[error.code]) ?? error.message ?? "Voice runtime error.";

  return (
    <div className="pointer-events-auto fixed bottom-24 right-6 z-40 flex max-w-xs items-start gap-3 rounded-lg border border-rose-300/40 bg-rose-50/95 px-3 py-2 text-xs text-rose-900 shadow-lg backdrop-blur dark:border-rose-500/40 dark:bg-rose-900/85 dark:text-rose-50">
      <span className="leading-snug">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full border border-rose-400/40 bg-rose-100/60 px-2 py-0.5 font-medium hover:bg-rose-100 dark:bg-rose-800/60 dark:hover:bg-rose-800"
      >
        retry
      </button>
    </div>
  );
}

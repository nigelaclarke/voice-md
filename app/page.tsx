"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorHandle } from "@/components/editor";
import { SAMPLE_DOC } from "@/components/editor";
import { TopBar, type ViewMode } from "@/components/topbar";
import { StartScreen, type OpenedDoc } from "@/components/start-screen";
import { SourceView } from "@/components/source-view";
import { Voice } from "@/components/voice";
import { uiStore } from "@/lib/ui-state";

// Editor is SSR-disabled because Milkdown / ProseMirror code can't run on the
// server. Don't move this into a different component — keep the dynamic-import
// boundary right here so app/page is the only place that pulls Milkdown into
// the browser bundle.
const Editor = dynamic(() => import("@/components/editor"), { ssr: false });

const SAMPLE = {
  filename: "q3-strategy-sync.md",
  content: SAMPLE_DOC,
  words: SAMPLE_DOC.trim().split(/\s+/).length,
};

export default function Home() {
  const editorRef = useRef<EditorHandle>(null);

  const [doc, setDoc] = useState<OpenedDoc | null>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [opening, setOpening] = useState<{ filename: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [sourceMarkdown, setSourceMarkdown] = useState<string>("");

  // When switching to source view, capture the current editor markdown.
  // Also dismiss any active surface — its ProseMirror range can't be measured
  // while the editor is display:none, so the surface would mis-anchor.
  useEffect(() => {
    if (viewMode !== "source") return;
    uiStore.dismissSurface();
    uiStore.setLastTransform(null);
    const handle = editorRef.current;
    if (handle && handle.isReady()) {
      setSourceMarkdown(handle.getDocument());
    } else {
      setSourceMarkdown(doc?.content ?? "");
    }
  }, [viewMode, doc?.content]);

  const handleOpen = (next: OpenedDoc) => {
    setOpening({ filename: next.filename });
    // Brief opening toast → swap in editor.
    setTimeout(() => {
      // Clear any stale surface/transform from a previous file before the
      // editor remounts (it's keyed on filename — old ranges are invalid).
      uiStore.dismissSurface();
      uiStore.setLastTransform(null);
      setDoc(next);
      setOpenedAt(Date.now());
      setOpening(null);
    }, 900);
  };

  const editedHint = useEditedHint(openedAt);

  // The editor stays mounted across view-mode swaps (just hidden) so its
  // ProseMirror state, voice handles, and selection rect persist when you
  // flip preview ↔ source.
  return (
    <div className="flex flex-1 flex-col">
      {doc && (
        <TopBar
          filename={doc.filename}
          editedHint={editedHint}
          viewMode={viewMode}
          onViewMode={setViewMode}
        />
      )}

      <main className="flex flex-1 flex-col">
        {doc ? (
          <div className="doc-wrap">
            <div style={viewMode === "source" ? { display: "none", width: "100%" } : { width: "100%", display: "flex", justifyContent: "center" }}>
              <Editor key={doc.filename} ref={editorRef} initialDoc={doc.content} />
            </div>
            {viewMode === "source" && <SourceView markdown={sourceMarkdown} />}
          </div>
        ) : null}
      </main>

      {doc && (
        <Voice
          editorRef={editorRef}
          selectionZoneEnabled={viewMode === "preview"}
        />
      )}

      {!doc && (
        <StartScreen onOpen={handleOpen} opening={opening} sample={SAMPLE} />
      )}
    </div>
  );
}

// Tiny hook: produces "just now", "edited 2m ago", "edited 1h ago" from a
// timestamp. Updates once a minute. Returns undefined when timestamp is null.
function useEditedHint(at: number | null): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [at]);
  return useMemo(() => {
    if (at === null) return undefined;
    const diff = Math.max(0, now - at);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just opened";
    if (mins < 60) return `edited ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `edited ${hours}h ago`;
    return `edited ${Math.floor(hours / 24)}d ago`;
  }, [at, now]);
}

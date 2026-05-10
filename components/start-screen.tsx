"use client";

// start-screen.tsx — first-load file-pick / drag-drop overlay.
// Three paths to a doc:
//   1. drop a file onto the dashed zone (or click → file picker)
//   2. open the bundled sample document
//   3. start with a new empty file
//
// The opening toast briefly confirms the choice before the overlay fades out.

import { useRef, useState } from "react";

export interface OpenedDoc {
  filename: string;
  content: string;
}

interface StartScreenProps {
  onOpen: (doc: OpenedDoc) => void;
  // When set, the overlay is in its fade-out animation; show the toast.
  opening: { filename: string } | null;
  sample: { filename: string; content: string; words: number };
}

export function StartScreen({ onOpen, opening, sample }: StartScreenProps) {
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.target === e.currentTarget) setDrag(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await readAndOpen(f);
    else onOpen({ filename: "untitled.md", content: "" });
  };
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) await readAndOpen(f);
  };
  const readAndOpen = async (f: File) => {
    const content = await f.text();
    onOpen({ filename: f.name, content });
  };

  const isOpening = !!opening;

  return (
    <div
      className={"start-screen" + (isOpening ? " opening" : "")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="start-inner">
        <div className="start-mark">◌</div>
        <h1 className="start-title">voice-md</h1>
        <p className="start-sub">
          a markdown editor you talk to.<br />
          select → hover → say what you mean.
        </p>

        <div
          className={"start-drop" + (drag ? " drag" : "")}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="start-drop-inner">
            <div className="start-drop-icon" aria-hidden="true">
              <span className="d-line d-line-1" />
              <span className="d-line d-line-2" />
              <span className="d-line d-line-3" />
            </div>
            <div className="start-drop-text">
              {drag ? (
                <span><strong>release</strong> to open</span>
              ) : (
                <span><strong>drop a markdown file</strong> here, or <u>browse</u></span>
              )}
            </div>
            <div className="start-drop-hint">.md · .markdown · .txt</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={onPick}
          />
        </div>

        <div className="start-or"><span>or</span></div>

        <div className="start-row">
          <button
            className="start-btn primary"
            type="button"
            onClick={() =>
              onOpen({ filename: sample.filename, content: sample.content })
            }
          >
            open sample document
            <span className="start-btn-sub">
              {sample.filename} · {sample.words} words
            </span>
          </button>
          <button
            className="start-btn"
            type="button"
            onClick={() => onOpen({ filename: "untitled.md", content: "" })}
          >
            new empty file
          </button>
        </div>

        <div className="start-foot">
          <span>⏎ ready when you are</span>
          <span className="sep">·</span>
          <a href="https://www.nigelclarke.ca" target="_blank" rel="noopener noreferrer">www.nigelclarke.ca</a>
        </div>
      </div>

      {isOpening && (
        <div className="start-opening-toast">
          <span className="spin" />
          <span>
            opening <code>{opening.filename}</code>…
          </span>
        </div>
      )}
    </div>
  );
}

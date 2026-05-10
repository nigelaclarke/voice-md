"use client";

// topbar.tsx — quiet metadata strip at the top of the editor.
// Crumb on the left (filename, last-edited hint). View toggle on the right
// (preview / source).

export type ViewMode = "preview" | "source";

interface TopBarProps {
  filename: string;
  editedHint?: string;
  viewMode: ViewMode;
  onViewMode: (next: ViewMode) => void;
  // When true, the dot in the crumb glows coral — the only "live" accent in
  // the topbar.
  live?: boolean;
}

export function TopBar({
  filename,
  editedHint,
  viewMode,
  onViewMode,
  live = false,
}: TopBarProps) {
  return (
    <div className="topbar">
      <div className="crumb">
        <span className={"dot" + (live ? " live" : "")} />
        <span>{filename}</span>
        {editedHint && (
          <>
            <span style={{ color: "var(--fg-4)" }}>·</span>
            <span>{editedHint}</span>
          </>
        )}
      </div>
      <div className="meta">
        <div className="viewtoggle">
          <button
            className={viewMode === "preview" ? "active" : ""}
            onClick={() => onViewMode("preview")}
            type="button"
          >
            preview
          </button>
          <button
            className={viewMode === "source" ? "active" : ""}
            onClick={() => onViewMode("source")}
            type="button"
          >
            source
          </button>
        </div>
      </div>
    </div>
  );
}

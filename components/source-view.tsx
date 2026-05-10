"use client";

// source-view.tsx — read-only line-numbered renderer of raw markdown.
//
// The voice flow needs a ProseMirror selection to operate on, so this view is
// read-only by design — switch back to preview to talk to the editor. The
// view dims markdown syntax (#, -, >, |, *, **, `) so the prose still reads
// like prose.

import { useMemo } from "react";

interface SourceViewProps {
  markdown: string;
}

export function SourceView({ markdown }: SourceViewProps) {
  const lines = useMemo(() => markdown.split("\n"), [markdown]);

  return (
    <div className="doc source">
      {lines.map((line, i) => (
        <span
          key={i}
          className="ln"
          data-ln={String(i + 1).padStart(2, " ")}
        >
          {renderLine(line)}
        </span>
      ))}
    </div>
  );
}

// Best-effort markdown syntax dimming. We aren't building a real parser —
// just visually quieting the structural characters so the prose stays
// readable.
function renderLine(line: string): React.ReactNode {
  if (line.length === 0) return "";

  // Headings — # to ######
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    const level = heading[1].length;
    const cls = level === 1 ? "md-h1" : level === 2 ? "md-h2" : "md-h3";
    return (
      <>
        <span className="md-syn">{heading[1]} </span>
        <span className={cls}>{renderInline(heading[2])}</span>
      </>
    );
  }

  // Blockquote
  const bq = /^(>\s?)(.*)$/.exec(line);
  if (bq) {
    return (
      <>
        <span className="md-syn">{bq[1]}</span>
        <span className="md-bq">{renderInline(bq[2])}</span>
      </>
    );
  }

  // Bullet list — -, *, +
  const ul = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (ul) {
    return (
      <>
        {ul[1]}
        <span className="md-syn">{ul[2]} </span>
        {renderInline(ul[3])}
      </>
    );
  }

  // Ordered list — "1. text"
  const ol = /^(\s*)(\d+\.)\s+(.*)$/.exec(line);
  if (ol) {
    return (
      <>
        {ol[1]}
        <span className="md-syn">{ol[2]} </span>
        {renderInline(ol[3])}
      </>
    );
  }

  // Table row
  if (line.trimStart().startsWith("|")) {
    return renderTableRow(line);
  }

  // Code fence
  if (line.startsWith("```")) {
    return <span className="md-syn">{line}</span>;
  }

  return renderInline(line);
}

function renderTableRow(line: string): React.ReactNode {
  // Split on | but keep the pipes.
  const parts = line.split(/(\|)/);
  return parts.map((part, i) =>
    part === "|" ? (
      <span key={i} className="md-tab">{part}</span>
    ) : (
      <span key={i}>{renderInline(part)}</span>
    ),
  );
}

// Inline emphasis / code / strong. Greedy first-match split; correct enough
// for read-only display.
function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let cursor = 0;
  // Pattern: **strong** | *em* | `code`
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <span key={key++}>
          <span className="md-syn">**</span>
          <span className="md-strong">{tok.slice(2, -2)}</span>
          <span className="md-syn">**</span>
        </span>,
      );
    } else if (tok.startsWith("*")) {
      out.push(
        <span key={key++}>
          <span className="md-syn">*</span>
          <span className="md-em">{tok.slice(1, -1)}</span>
          <span className="md-syn">*</span>
        </span>,
      );
    } else {
      out.push(
        <span key={key++}>
          <span className="md-syn">`</span>
          <span className="md-code">{tok.slice(1, -1)}</span>
          <span className="md-syn">`</span>
        </span>,
      );
    }
    cursor = m.index + tok.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

"use client";

// editor.tsx — the only file in the app that knows ProseMirror exists.
// Mounts Milkdown (commonmark preset) and exposes a tiny imperative handle.

import { Editor as MilkdownEditor } from "@milkdown/core";
import {
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import { history } from "@milkdown/plugin-history";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { Slice } from "@milkdown/prose/model";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Editor } from "@milkdown/core";

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
}

export interface EditorHandle {
  isReady: () => boolean;
  getSelection: () => SelectionInfo | null;
  getDocument: () => string;
  // Returns the post-edit range — i.e. the actual ProseMirror positions
  // covering the inserted markdown. Use this for surface anchoring and for
  // subsequent edits that target the same region (e.g. dial-tick changes).
  replaceSelection: (
    markdown: string,
    range?: { from: number; to: number },
  ) => { from: number; to: number } | null;
  insertAtCursor: (markdown: string) => { from: number; to: number } | null;
  getSelectionRect: () => DOMRect | null;
  getRangeRect: (from: number, to: number) => DOMRect | null;
  setPendingHighlight: (range: { from: number; to: number } | null) => void;
  flashFreshHighlight: (range: { from: number; to: number }) => void;
  focus: () => void;
}

// Default sample document. Exported so the start screen can offer it as the
// "open sample document" button content.
export const SAMPLE_DOC = `# Project Spark Doc

> Nigel Clarke · generative-ui · voice gestures · may 9 2026

VoiceMD started from a simple observation: most editors treat AI as a sidebar, but the model could just as easily speak through the document itself. The features below cover three loose categories — gesture physics, model-driven UI, and the older lineage of voice-as-edit — and most of them got mutated heavily before landing in the build. The list is intentionally a little messy because we wanted the seams visible while we were still deciding what to keep.

## Features

- Hover-to-act zones — gesture — invisible regions as a first-class affordance
- Ambient dictation — voice — mic capture without an explicit button press
- Selection-as-context edits — intent — the highlighted span is the prompt
- Model-emitted UI specs — surface — host renders structured output verbatim
- Direction-as-verb gestures — input — spatial movement carries semantic meaning

## Tech stack

| Layer | Tool |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind 4 |
| Editor | Milkdown 7 on ProseMirror |
| Voice | OpenAI Realtime API over WebRTC |
| Language | TypeScript 5 |
| Dev | Claude Code + Claude Design |
`;

// ---- Decoration plugin: pending + fresh highlights -----------------------

type DecorationCommand =
  | { kind: "pending"; range: { from: number; to: number } | null }
  | { kind: "fresh"; range: { from: number; to: number } };

const decorationPluginKey = new PluginKey<DecorationState>("voicemd-decorations");

interface DecorationState {
  pending: { from: number; to: number } | null;
  fresh: { from: number; to: number; expiresAt: number } | null;
}

const decorationPlugin = new Plugin<DecorationState>({
  key: decorationPluginKey,
  state: {
    init: () => ({ pending: null, fresh: null }),
    apply(tr, value) {
      let next = value;
      const meta = tr.getMeta(decorationPluginKey) as
        | DecorationCommand
        | undefined;
      if (meta) {
        if (meta.kind === "pending") {
          next = { ...next, pending: meta.range };
        } else if (meta.kind === "fresh") {
          next = {
            ...next,
            fresh: { ...meta.range, expiresAt: Date.now() + 1700 },
          };
        }
      }
      // Map ranges through any doc changes.
      if (tr.docChanged) {
        next = {
          pending: next.pending
            ? {
                from: tr.mapping.map(next.pending.from),
                to: tr.mapping.map(next.pending.to),
              }
            : null,
          fresh: next.fresh
            ? {
                from: tr.mapping.map(next.fresh.from),
                to: tr.mapping.map(next.fresh.to),
                expiresAt: next.fresh.expiresAt,
              }
            : null,
        };
      }
      // Auto-expire fresh after the animation length.
      if (next.fresh && next.fresh.expiresAt <= Date.now()) {
        next = { ...next, fresh: null };
      }
      return next;
    },
  },
  props: {
    decorations(state) {
      const ps = decorationPluginKey.getState(state);
      if (!ps) return null;
      const decos: Decoration[] = [];
      if (ps.pending && ps.pending.from !== ps.pending.to) {
        decos.push(
          Decoration.inline(ps.pending.from, ps.pending.to, {
            class: "voicemd-pending-highlight",
          }),
        );
      }
      if (ps.fresh && ps.fresh.from !== ps.fresh.to) {
        decos.push(
          Decoration.inline(ps.fresh.from, ps.fresh.to, {
            class: "voicemd-fresh-highlight",
          }),
        );
      }
      return decos.length ? DecorationSet.create(state.doc, decos) : null;
    },
  },
});

// ---- The component -------------------------------------------------------

interface InnerProps {
  initialDoc: string;
  onReady: (handle: EditorHandle) => void;
}

function MilkdownInner({ initialDoc, onReady }: InnerProps) {
  // Milkdown's parser needs at least one paragraph. An empty string would
  // produce an editor with no editable position; substitute a single newline
  // so the user can start typing into a fresh empty paragraph.
  const safeInitial = initialDoc.length > 0 ? initialDoc : "\n";
  const { loading, get } = useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, safeInitial);
      })
      .use(commonmark)
      // GFM adds tables, strikethrough, task lists, and autolinks. Without
      // it, the model's `| col | col |` markdown gets parsed as plain text
      // by the commonmark-only parser and renders as a paragraph.
      .use(gfm)
      .use(history),
  );

  // Register the decoration plugin once the editor is built.
  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;

    // We need to inject our prose plugin. Milkdown supports this via the
    // `prosePluginsCtx`, but since we're inside the editor lifecycle we can
    // use a small custom Milkdown plugin instead.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // Splice our plugin into the existing list.
      const existing = view.state.plugins;
      if (existing.some((p) => (p as Plugin).spec.key === decorationPluginKey)) {
        return;
      }
      const newState = view.state.reconfigure({
        plugins: [...existing, decorationPlugin],
      });
      view.updateState(newState);
    });

    onReady(buildHandle(editor));
  }, [loading, get, onReady]);

  // The .doc-wrap parent handles centering/padding; .voicemd-editor here
  // matches the design's .doc max-width and right gutter.
  return (
    <div className="voicemd-editor doc">
      <Milkdown />
    </div>
  );
}

interface EditorProps {
  initialDoc?: string;
}

const VoiceMDEditor = forwardRef<EditorHandle, EditorProps>((props, ref) => {
  const handleRef = useRef<EditorHandle | null>(null);

  const onReady = useCallback((handle: EditorHandle) => {
    handleRef.current = handle;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      isReady: () => handleRef.current?.isReady() ?? false,
      getSelection: () => handleRef.current?.getSelection() ?? null,
      getDocument: () => handleRef.current?.getDocument() ?? "",
      replaceSelection: (md, range) =>
        handleRef.current?.replaceSelection(md, range) ?? null,
      insertAtCursor: (md) => handleRef.current?.insertAtCursor(md) ?? null,
      getSelectionRect: () => handleRef.current?.getSelectionRect() ?? null,
      getRangeRect: (from, to) =>
        handleRef.current?.getRangeRect(from, to) ?? null,
      setPendingHighlight: (range) =>
        handleRef.current?.setPendingHighlight(range),
      flashFreshHighlight: (range) =>
        handleRef.current?.flashFreshHighlight(range),
      focus: () => handleRef.current?.focus(),
    }),
    [],
  );

  return (
    <MilkdownProvider>
      <MilkdownInner initialDoc={props.initialDoc ?? SAMPLE_DOC} onReady={onReady} />
    </MilkdownProvider>
  );
});

VoiceMDEditor.displayName = "VoiceMDEditor";

export default VoiceMDEditor;

// ---- Imperative handle implementation ------------------------------------

function buildHandle(editor: Editor): EditorHandle {
  return {
    isReady() {
      return true;
    },
    getSelection() {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        if (from === to) return null;
        const text = view.state.doc.textBetween(from, to, "\n", "\n");
        return { from, to, text };
      });
    },
    getDocument() {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const serializer = ctx.get(serializerCtx);
        return serializer(view.state.doc);
      });
    },
    replaceSelection(markdown, range) {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const node = parser(markdown);
        if (!node) return null;
        const slice = Slice.maxOpen(node.content);

        // Clamp the requested range to the current doc — defensive in case
        // upstream state drifted (the bug below corrupted ranges historically;
        // clamping prevents tr.replaceRange from constructing out-of-bounds
        // steps even if a stale lt.range slips through).
        const docSize = view.state.doc.content.size;
        const rawFrom = range
          ? Math.min(range.from, range.to)
          : view.state.selection.from;
        const rawTo = range
          ? Math.max(range.from, range.to)
          : view.state.selection.to;
        const fromBefore = Math.max(0, Math.min(docSize, rawFrom));
        const toBefore = Math.max(fromBefore, Math.min(docSize, rawTo));

        let tr = view.state.tr;
        if (range && fromBefore !== toBefore) {
          tr = tr.replaceRange(fromBefore, toBefore, slice);
        } else {
          tr = tr.replaceSelection(slice);
        }
        const insertedFrom = fromBefore;
        // CRITICAL: do NOT use view.state.selection.from to derive insertedTo.
        // tr.replaceRange (unlike tr.replaceSelection) does not relocate the
        // selection — it just maps it through the change. So selection.from
        // after dispatch is only the "end of insert" if the caret happened to
        // be inside the replaced range. For cards-preview / dial-tick re-edits
        // the caret is usually at the end of the PREVIOUS insert (which equals
        // toBefore here), but we can't rely on that. Map toBefore through the
        // transaction's mapping — that authoritatively tells us where the end
        // of the replaced range landed (i.e. the end of the new inserted
        // content). If we used the selection-based heuristic, lt.range would
        // drift on every re-edit until tr.replaceRange constructed a step
        // with negative positions, exploding inside the history plugin's
        // invert pass with "Position -N outside of fragment".
        const insertedTo = tr.mapping.map(toBefore);
        view.dispatch(tr);
        // Flash the inserted region.
        view.dispatch(
          view.state.tr.setMeta(decorationPluginKey, {
            kind: "fresh",
            range: { from: insertedFrom, to: insertedTo },
          } satisfies DecorationCommand),
        );
        // Clear any pending highlight now that the edit landed.
        view.dispatch(
          view.state.tr.setMeta(decorationPluginKey, {
            kind: "pending",
            range: null,
          } satisfies DecorationCommand),
        );
        return { from: insertedFrom, to: insertedTo };
      });
    },
    insertAtCursor(markdown) {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const node = parser(markdown);
        if (!node) return null;
        const slice = Slice.maxOpen(node.content);
        const { from } = view.state.selection;
        const tr = view.state.tr.replaceRange(from, from, slice);
        view.dispatch(tr);
        const insertedTo = view.state.selection.from;
        view.dispatch(
          view.state.tr.setMeta(decorationPluginKey, {
            kind: "fresh",
            range: { from, to: insertedTo },
          } satisfies DecorationCommand),
        );
        return { from, to: insertedTo };
      });
    },
    getSelectionRect() {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        if (from === to) return null;
        return rectFromCoords(view, from, to);
      });
    },
    getRangeRect(from, to) {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        return rectFromCoords(view, from, to);
      });
    },
    setPendingHighlight(range) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setMeta(decorationPluginKey, {
            kind: "pending",
            range,
          } satisfies DecorationCommand),
        );
      });
    },
    flashFreshHighlight(range) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setMeta(decorationPluginKey, {
            kind: "fresh",
            range,
          } satisfies DecorationCommand),
        );
      });
    },
    focus() {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
      });
    },
  };
}

function rectFromCoords(
  view: { coordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } },
  from: number,
  to: number,
): DOMRect | null {
  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    return new DOMRect(left, top, right - left, bottom - top);
  } catch {
    return null;
  }
}

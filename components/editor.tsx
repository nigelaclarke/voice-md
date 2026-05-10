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
export const SAMPLE_DOC = `# Q3 strategy sync

> meeting · oct 14 · attended by 6

We met to align on priorities for Q3 and surface blockers before the planning offsite. The conversation moved between revenue concerns and the platform migration timeline, with most of the disagreement concentrated on resourcing.

## Decisions

- Ship the redesigned dashboard before Q3 close
- Pause the marketing site refresh until after launch
- Hire two more engineers, both senior, both backend

## Open questions

- Do we extend the contract with Acme through end of year, or renegotiate now?
- Who owns the migration runbook — Devon or Priya?
- Should the data export feature be gated to Pro tier or free for all paying users?

## Next steps

By Friday, Devon will draft the resourcing proposal. Priya is going to review the migration timeline against the contract terms. We'll reconvene Monday at 10am to lock the plan.
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

        let tr = view.state.tr;
        if (range && range.from !== range.to) {
          tr = tr.replaceRange(range.from, range.to, slice);
        } else {
          tr = tr.replaceSelection(slice);
        }
        const insertedFrom = range
          ? Math.min(range.from, range.to)
          : view.state.selection.from;
        // After dispatch, selection.head sits at the end of the insert.
        view.dispatch(tr);
        const insertedTo = view.state.selection.from;
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

"use client";

/**
 * Markdown source editor with readability highlighting (CodeMirror 6).
 *
 * Edits the Markdown source directly (no WYSIWYG round-trip — see the plan's
 * editor rationale), and paints flagged long sentences/paragraphs inline via
 * range decorations. The flagged ranges are computed by the parent from the
 * same pure checks the analysis panel uses, so highlight and panel agree.
 *
 * Exposes an imperative `selectRange(start, end)` so the panel's flagged list
 * can scroll to / select a span when clicked.
 */

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export type HighlightRange = {
  start: number;
  end: number;
  severity: "amber" | "red";
};

export type MarkdownEditorHandle = {
  selectRange: (start: number, end: number) => void;
};

const highlightTheme = EditorView.baseTheme({
  ".cm-readability-red": {
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderBottom: "1px solid rgba(239, 68, 68, 0.55)",
  },
  ".cm-readability-amber": {
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderBottom: "1px solid rgba(245, 158, 11, 0.55)",
  },
});

/**
 * Decorations facet fed by a function so stale ranges (offsets from a slightly
 * older body, before the parent recomputes) are clamped to the live document
 * length instead of throwing "decoration outside of document".
 */
function decorationsFor(ranges: HighlightRange[]) {
  return EditorView.decorations.of((view): DecorationSet => {
    const docLen = view.state.doc.length;
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const builder = new RangeSetBuilder<Decoration>();
    for (const r of sorted) {
      const start = Math.max(0, Math.min(r.start, docLen));
      const end = Math.max(start, Math.min(r.end, docLen));
      if (end <= start) continue;
      builder.add(
        start,
        end,
        Decoration.mark({
          class: r.severity === "red" ? "cm-readability-red" : "cm-readability-amber",
        }),
      );
    }
    return builder.finish();
  });
}

const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    ranges?: HighlightRange[];
    placeholder?: string;
    className?: string;
    editable?: boolean;
  }
>(function MarkdownEditor(
  { value, onChange, ranges = [], placeholder, className, editable = true },
  ref,
) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  useImperativeHandle(
    ref,
    () => ({
      selectRange(start: number, end: number) {
        const view = cmRef.current?.view;
        if (!view) return;
        const len = view.state.doc.length;
        const a = Math.max(0, Math.min(start, len));
        const b = Math.max(a, Math.min(end, len));
        view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
        view.focus();
      },
    }),
    [],
  );

  const extensions = useMemo(
    () => [markdown(), EditorView.lineWrapping, highlightTheme, decorationsFor(ranges)],
    [ranges],
  );

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      extensions={extensions}
      editable={editable}
      placeholder={placeholder}
      className={className}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        searchKeymap: false,
      }}
    />
  );
});

export default MarkdownEditor;

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  LanguageDescription,
  type LanguageSupport,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { takeLine } from "../../hooks/editorTargets.js";
import { editorHighlighting, editorTheme } from "./editorTheme.js";

/** A selection in the editor: its text, and where it runs, 1-based. */
export interface EditorSelectionInfo {
  text: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

function selectionInfo(state: EditorState): EditorSelectionInfo | null {
  const range = state.selection.main;
  if (range.empty) return null;
  const at = (position: number) => {
    const line = state.doc.lineAt(position);
    return { line: line.number, column: position - line.from + 1 };
  };
  return {
    text: state.sliceDoc(range.from, range.to),
    start: at(range.from),
    end: at(range.to),
  };
}

/**
 * The text of a file, editable.
 *
 * CodeMirror owns the document; React owns when it is replaced. `content` is
 * only pushed into the editor when it names a new version of the file (a new
 * `token`), so a poll that returns what is already on screen does not undo a
 * keystroke. The language loads by file name, on demand.
 */
export function Editor({
  path,
  content,
  token,
  readOnly = false,
  onChange,
  onSave,
  onSelection,
}: {
  path: string;
  content: string;
  /** Which version of the file `content` is. */
  token: string;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  /** The text selected, with where it starts and ends; null when none is. */
  onSelection?: (selection: EditorSelectionInfo | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const latest = useRef({ onChange, onSave, onSelection });
  latest.current = { onChange, onSave, onSelection };

  // The editor is built once per file; later content arrives through the
  // token effect below, and the handlers through the ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per path
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              latest.current.onSave();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        editorTheme,
        editorHighlighting,
        EditorView.lineWrapping,
        language.current.of([]),
        editable.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            latest.current.onSelection?.(selectionInfo(update.state));
          }
        }),
      ],
    });
    const editor = new EditorView({ state, parent });
    view.current = editor;
    // A search hit asked for a line: land on it, selected, in view.
    const target = takeLine(path);
    if (target) {
      const line = editor.state.doc.line(Math.min(target.line, editor.state.doc.lines));
      const from = Math.min(line.from + target.column - 1, line.to);
      const to = Math.min(from + target.length, line.to);
      editor.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      editor.focus();
    }
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const description = LanguageDescription.matchFilename(languages, path);
    if (!description) {
      editor.dispatch({ effects: language.current.reconfigure([]) });
      return;
    }
    let cancelled = false;
    void description.load().then((support: LanguageSupport) => {
      if (!cancelled && view.current === editor) {
        editor.dispatch({ effects: language.current.reconfigure(support) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // A new version of the file from the machine replaces the document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the token names the version
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === content) return;
    editor.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [token]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror in Exeora's clothes: the same surface, border and type as the
 * rest of the dashboard, and a small palette for syntax that stays close
 * to the grayscale with the brand's one hue for names.
 */
export const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--color-bg)",
      color: "var(--color-foreground)",
      fontSize: "12px",
      height: "100%",
    },
    ".cm-content": { fontFamily: "var(--font-mono)", padding: "8px 0" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-gutters": {
      backgroundColor: "var(--color-bg)",
      color: "var(--color-foreground-faint)",
      borderRight: "1px solid var(--color-border-subtle)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(236, 236, 236, 0.04)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(236, 236, 236, 0.06)" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(79, 209, 197, 0.2)",
    },
    ".cm-matchingBracket": { backgroundColor: "rgba(79, 209, 197, 0.25)" },
    ".cm-panels": {
      backgroundColor: "var(--color-surface)",
      color: "var(--color-foreground)",
      borderColor: "var(--color-border-subtle)",
    },
    ".cm-panel input, .cm-panel button": {
      backgroundColor: "var(--color-bg)",
      color: "var(--color-foreground)",
      border: "1px solid var(--color-border)",
      borderRadius: "6px",
    },
    ".cm-searchMatch": { backgroundColor: "rgba(251, 191, 36, 0.25)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(251, 191, 36, 0.5)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: "#c084fc" },
  { tag: [tags.string, tags.special(tags.string)], color: "#34d399" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#fbbf24" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "#6d757e",
    fontStyle: "italic",
  },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#4fd1c5" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#f4f5f6", fontWeight: "500" },
  { tag: [tags.propertyName, tags.attributeName], color: "#9aa2ab" },
  { tag: [tags.operator, tags.punctuation], color: "#9aa2ab" },
  { tag: tags.heading, color: "#f4f5f6", fontWeight: "600" },
  { tag: tags.link, color: "#4fd1c5", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.invalid, color: "#f87171" },
]);

export const editorHighlighting = syntaxHighlighting(highlight);

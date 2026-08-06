/**
 * Text matching and patch generation for `edit_file`.
 *
 * Adapted from pi-coding-agent's `src/core/tools/edit-diff.ts` (MIT, Copyright
 * (c) 2025 Mario Zechner); see the third-party notice in this package's
 * LICENSE. Taken rather than depended on because the published tool wraps this
 * logic in a terminal UI: reaching it through `@earendil-works/pi-coding-agent`
 * pulled a syntax highlighter, a wasm image resizer and an agent runtime into
 * the install, 172 MB of it, none of which Exeora ever renders.
 *
 * Trimmed to what the executor needs. The display diff and the preview helpers
 * are gone; `edit_file` returns a unified patch and nothing here draws.
 *
 * Adjusted for this package's stricter compiler settings
 * (`noUncheckedIndexedAccess`), which is why indexed reads are guarded.
 */

import * as Diff from "diff";

export interface Edit {
  oldText: string;
  newText: string;
}

export interface AppliedEditsResult {
  baseContent: string;
  newContent: string;
}

// ---------------------------------------------------------------------------
// Line endings and BOM
// ---------------------------------------------------------------------------

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIndex = content.indexOf("\r\n");
  const lfIndex = content.indexOf("\n");
  if (lfIndex === -1) return "\n";
  if (crlfIndex === -1) return "\n";
  return crlfIndex < lfIndex ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/** Split off a UTF-8 BOM so it never has to appear in the caller's oldText. */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      // Strip trailing whitespace per line
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // Smart single quotes → '
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      // Smart double quotes → "
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
      // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      // U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
      // U+205F medium math space, U+3000 ideographic space
      .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
  );
}

interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  /** False when the text was found byte for byte. */
  usedFuzzyMatch: boolean;
}

/**
 * Find oldText in content, exactly first and only then approximately.
 *
 * A fuzzy hit reports offsets in fuzzy-normalized space, so the caller has to
 * do its replacements against the same normalized content.
 */
function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false };
  }

  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false };
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
  };
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

// ---------------------------------------------------------------------------
// Applying replacements
// ---------------------------------------------------------------------------

interface LineSpan {
  start: number;
  end: number;
}

interface MatchedEdit {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

type TextReplacement = Pick<MatchedEdit, "matchIndex" | "matchLength" | "newText">;

const OUT_OF_RANGE = "Replacement range is outside the base content.";

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

function spanAt(spans: LineSpan[], index: number): LineSpan {
  const span = spans[index];
  if (!span) throw new Error(OUT_OF_RANGE);
  return span;
}

function getReplacementLineRange(lines: LineSpan[], replacement: TextReplacement) {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;

  let startLine = -1;
  for (const [index, line] of lines.entries()) {
    if (replacementStart >= line.start && replacementStart < line.end) {
      startLine = index;
      break;
    }
  }
  if (startLine === -1) throw new Error(OUT_OF_RANGE);

  let endLine = startLine;
  while (endLine < lines.length) {
    const line = lines[endLine];
    if (!line || line.end >= replacementEnd) break;
    endLine++;
  }
  if (endLine >= lines.length) throw new Error(OUT_OF_RANGE);

  return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: TextReplacement[], offset = 0): string {
  let result = content;
  // Back to front, so an earlier replacement cannot move a later one's offsets.
  for (const replacement of [...replacements].reverse()) {
    const matchIndex = replacement.matchIndex - offset;
    result =
      result.substring(0, matchIndex) +
      replacement.newText +
      result.substring(matchIndex + replacement.matchLength);
  }
  return result;
}

/**
 * Apply replacements matched against `baseContent` to `originalContent` while
 * preserving unchanged line blocks from the original.
 *
 * This is what keeps a fuzzy match from rewriting the whole file: `baseContent`
 * is a normalized view, so every line it touched would otherwise come back
 * normalized. Each replacement is widened to the lines it actually covers, only
 * those lines are taken from the normalized base, and the rest are copied back
 * verbatim. Using the replacement ranges rather than line equality is what
 * stops a duplicate normalized line from being aligned to the wrong occurrence.
 */
function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error(
      "Cannot preserve unchanged lines because the base content has a different line count.",
    );
  }

  const groups: Array<{ startLine: number; endLine: number; replacements: TextReplacement[] }> = [];
  const sorted = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
  for (const replacement of sorted) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups.at(-1);
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }

  let originalLineIndex = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");

    const groupStartOffset = spanAt(baseLines, group.startLine).start;
    const groupEndOffset = spanAt(baseLines, group.endLine - 1).end;
    result += applyReplacements(
      baseContent.slice(groupStartOffset, groupEndOffset),
      group.replacements,
      groupStartOffset,
    );
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join("");

  return result;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function notFoundError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
    );
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
  );
}

function duplicateError(
  path: string,
  editIndex: number,
  totalEdits: number,
  occurrences: number,
): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

function emptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) return new Error(`oldText must not be empty in ${path}.`);
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function noChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

// ---------------------------------------------------------------------------

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * Every edit is matched against the same original content, so the caller does
 * not have to reason about how earlier edits shifted the file. Ambiguity is a
 * refusal, never a guess: a match that appears more than once throws rather
 * than picking the first one.
 */
export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  for (const [index, edit] of normalizedEdits.entries()) {
    if (edit.oldText.length === 0) {
      throw emptyOldTextError(path, index, normalizedEdits.length);
    }
  }

  // If any edit needed fuzzy matching, every edit is matched in normalized
  // space, so a single set of offsets describes them all.
  const initialMatches = normalizedEdits.map((edit) =>
    fuzzyFindText(normalizedContent, edit.oldText),
  );
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
  const replacementBaseContent = usedFuzzyMatch
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;

  const matchedEdits: MatchedEdit[] = [];
  for (const [index, edit] of normalizedEdits.entries()) {
    const match = fuzzyFindText(replacementBaseContent, edit.oldText);
    if (!match.found) {
      throw notFoundError(path, index, normalizedEdits.length);
    }

    const occurrences = countOccurrences(replacementBaseContent, edit.oldText);
    if (occurrences > 1) {
      throw duplicateError(path, index, normalizedEdits.length, occurrences);
    }

    matchedEdits.push({
      editIndex: index,
      matchIndex: match.index,
      matchLength: match.matchLength,
      newText: edit.newText,
    });
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  let previous: MatchedEdit | undefined;
  for (const current of matchedEdits) {
    if (previous && previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
    previous = current;
  }

  const baseContent = normalizedContent;
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(
        normalizedContent,
        replacementBaseContent,
        matchedEdits,
      )
    : applyReplacements(replacementBaseContent, matchedEdits);

  if (baseContent === newContent) {
    throw noChangeError(path, normalizedEdits.length);
  }

  return { baseContent, newContent };
}

/** Generate a standard unified patch. */
export function generateUnifiedPatch(
  path: string,
  oldContent: string,
  newContent: string,
  contextLines = 4,
): string {
  return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context: contextLines,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
}

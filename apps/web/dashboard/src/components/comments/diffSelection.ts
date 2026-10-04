import { parsePatchFiles } from "@pierre/diffs";
import type { SourceInView } from "./model.js";

/**
 * What a range of diff lines selected in the renderer says: the rows the
 * person sees selected, and the lines of the old and new file they cover.
 *
 * The renderer reports each end of a range as a line number on a side:
 * `deletions` for the old file, `additions` for the new one. Side by side, a
 * range within one column is that column only: the other column's rows
 * between its ends are not part of it. In one column, or across both, the
 * rows between the ends in patch order are.
 */

export interface PatchRow {
  type: "context" | "addition" | "deletion";
  old: number | null;
  new: number | null;
  text: string;
}

type Side = "deletions" | "additions";

export interface LineRange {
  start: number;
  side?: Side;
  end: number;
  endSide?: Side;
}

export function patchRows(patch: string): PatchRow[] {
  const rows: PatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      rows.push({ type: "addition", old: null, new: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ type: "deletion", old: oldLine++, new: null, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      rows.push({ type: "context", old: oldLine++, new: newLine++, text: line.slice(1) });
    }
  }
  return rows;
}

const numberOn = (row: PatchRow, side: Side | undefined) =>
  side === "deletions" ? row.old : side === "additions" ? row.new : (row.new ?? row.old);

/** The rows a range selects, as the renderer showed them; null when it names none. */
export function selectedRows(
  rows: PatchRow[],
  range: LineRange,
  mode: "unified" | "split" = "unified",
): PatchRow[] | null {
  const endSide = range.endSide ?? range.side;
  const oneColumn = mode === "split" && range.side !== undefined && range.side === endSide;
  // Side by side within one column, the rows of that column only.
  const pool = oneColumn ? rows.filter((row) => numberOn(row, range.side) !== null) : rows;
  const a = pool.findIndex((row) => numberOn(row, range.side) === range.start);
  const b = pool.findIndex((row) => numberOn(row, endSide) === range.end);
  if (a < 0 || b < 0) return null;
  return pool.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The file a one-file patch is about, as git names it: renames and quoted names included. */
export function patchNames(
  patch: string,
  fallback: string,
): { path: string; oldPath: string | null } {
  try {
    const file = parsePatchFiles(patch)[0]?.files[0];
    if (file?.name) {
      return {
        path: unescapeGitPath(file.name),
        oldPath: file.prevName ? unescapeGitPath(file.prevName) : null,
      };
    }
  } catch {
    // An unreadable header still has the path the list was showing.
  }
  return { path: fallback, oldPath: null };
}

/**
 * A name git wrote C-quoted (`"caf\303\251.txt"`), as the file is really
 * called: octal escapes are UTF-8 bytes. A plain name comes back unchanged.
 */
export function unescapeGitPath(name: string): string {
  if (!name.includes("\\")) return name;
  const bytes: number[] = [];
  const named: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    '"': 34,
    "\\": 92,
    a: 7,
    b: 8,
    f: 12,
    v: 11,
  };
  for (let i = 0; i < name.length; i += 1) {
    const char = name[i] ?? "";
    if (char !== "\\") {
      bytes.push(...new TextEncoder().encode(char));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(name.slice(i + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    const next = name[i + 1] ?? "";
    bytes.push(named[next] ?? next.charCodeAt(0));
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function diffSelection(
  patch: string,
  range: LineRange,
  place: {
    path: string;
    oldPath: string | null;
    area: "working" | "staged" | null;
    commit: string | null;
  },
  mode: "unified" | "split" = "unified",
): { source: SourceInView; snippet: string } | null {
  const rows = selectedRows(patchRows(patch), range, mode);
  if (!rows || rows.length === 0) return null;
  const endSide = range.endSide ?? range.side;
  const column = mode === "split" && range.side !== undefined && range.side === endSide;
  const touchesOld = rows.some((row) => row.type === "deletion");
  const touchesNew = rows.some((row) => row.type === "addition");
  const side: "old" | "new" | "both" = column
    ? range.side === "deletions"
      ? "old"
      : "new"
    : touchesOld && touchesNew
      ? "both"
      : touchesOld
        ? "old"
        : touchesNew
          ? "new"
          : range.side === "deletions"
            ? "old"
            : "new";
  const olds =
    side === "new" && column ? [] : rows.flatMap((row) => (row.old === null ? [] : [row.old]));
  const news =
    side === "old" && column ? [] : rows.flatMap((row) => (row.new === null ? [] : [row.new]));
  const snippet = rows
    .map(
      (row) => `${row.type === "addition" ? "+" : row.type === "deletion" ? "-" : " "}${row.text}`,
    )
    .join("\n");
  return {
    snippet,
    source: {
      kind: "diff",
      path: place.path,
      oldPath: place.oldPath,
      area: place.area,
      commit: place.commit,
      side,
      oldLines: olds.length ? [Math.min(...olds), Math.max(...olds)] : null,
      newLines: news.length ? [Math.min(...news), Math.max(...news)] : null,
    },
  };
}

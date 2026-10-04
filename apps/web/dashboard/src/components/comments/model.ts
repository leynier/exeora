/**
 * Comments on what the Workspace shows, written in ChatGPT's panel and handed
 * to the model only when the person says so.
 *
 * A comment is pinned to its source as it was when it was made: the project,
 * working copy and path, and the exact text or diff lines selected. Moving
 * elsewhere in the panel leaves it as it was. Nothing here reads a file: the
 * snippet is what the person selected, and nothing more is ever sent.
 */

export const LIMITS = {
  snippetChars: 4_000,
  snippetLines: 200,
  commentChars: 4_000,
  batchComments: 25,
  batchChars: 40_000,
} as const;

export interface Place {
  projectId: string;
  /** The working copy's selector; null for the root of the default location. */
  workspace: string | null;
  path: string;
}

export interface Position {
  line: number;
  column: number;
}

export type CommentSource =
  | (Place & {
      kind: "file";
      /** The file's version the selection was made in. */
      version: string;
      /** Whether the selection came from edits not yet saved. */
      unsaved: boolean;
      start: Position;
      end: Position;
    })
  | (Place & {
      kind: "diff";
      /** The path before a rename, when the patch says there was one. */
      oldPath: string | null;
      /** Which changes: the working tree, the index, or a commit. */
      area: "working" | "staged" | null;
      commit: string | null;
      /** Lines of the old file, the new one, or both. */
      side: "old" | "new" | "both";
      oldLines: [number, number] | null;
      newLines: [number, number] | null;
    });

export interface Draft {
  id: string;
  source: CommentSource;
  snippet: string;
  comment: string;
  createdAt: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A source as a view knows it: the panel adds the project and working copy. */
export type SourceInView = DistributiveOmit<CommentSource, "projectId" | "workspace">;

/** What a selection offers to be commented on, before anything is written. */
export interface Selected {
  source: CommentSource;
  snippet: string;
}

/** Why a selection cannot be commented, or null when it can. */
export function snippetProblem(snippet: string): string | null {
  if (snippet.trim() === "") return "Select some text first.";
  if (snippet.length > LIMITS.snippetChars) {
    return `The selection is longer than ${LIMITS.snippetChars.toLocaleString("en")} characters. Select less to comment on it.`;
  }
  if (snippet.split("\n").length > LIMITS.snippetLines) {
    return `The selection spans more than ${LIMITS.snippetLines} lines. Select less to comment on it.`;
  }
  return null;
}

export function commentProblem(comment: string): string | null {
  if (comment.trim() === "") return "Write a comment first.";
  if (comment.length > LIMITS.commentChars) {
    return `A comment can be at most ${LIMITS.commentChars.toLocaleString("en")} characters.`;
  }
  return null;
}

/** Why these drafts cannot go as one batch, or null when they can. */
export function batchProblem(drafts: readonly Draft[]): string | null {
  if (drafts.length === 0) return "There are no comments to add.";
  if (drafts.length > LIMITS.batchComments) {
    return `At most ${LIMITS.batchComments} comments can be added at once. Delete some, or add them in parts.`;
  }
  if (formatBatch(drafts).length > LIMITS.batchChars) {
    return "These comments are too long to add at once. Delete some, or add them in parts.";
  }
  return null;
}

export function sourceLabel(source: CommentSource): string {
  if (source.kind === "file") {
    const { start, end } = source;
    const range =
      start.line === end.line ? `line ${start.line}` : `lines ${start.line}-${end.line}`;
    return `${source.path}, ${range}`;
  }
  const lines =
    source.side === "old"
      ? `old ${span(source.oldLines)}`
      : source.side === "new"
        ? `new ${span(source.newLines)}`
        : `old ${span(source.oldLines)}, new ${span(source.newLines)}`;
  const where = source.commit
    ? `commit ${source.commit.slice(0, 12)}`
    : source.area === "staged"
      ? "staged"
      : "working tree";
  return `${source.path}, ${where} diff, ${lines}`;
}

function span(range: [number, number] | null): string {
  if (!range) return "none";
  return range[0] === range[1] ? `line ${range[0]}` : `lines ${range[0]}-${range[1]}`;
}

export function batchTitle(drafts: readonly Draft[]): string {
  const files = new Set(drafts.map((draft) => draft.source.path)).size;
  const count = drafts.length === 1 ? "1 comment" : `${drafts.length} comments`;
  return `Exeora Workspace: ${count} on ${files === 1 ? "1 file" : `${files} files`}`;
}

/** The text the model reads: each comment with where it points and what was selected. */
export function formatBatch(drafts: readonly Draft[]): string {
  const parts = drafts.map((draft, index) => {
    const { source } = draft;
    const where = [
      `Project: ${source.projectId}`,
      `Workspace: ${source.workspace ?? "default root"}`,
      `Path: ${source.path}`,
    ];
    if (source.kind === "file") {
      where.push(
        `Selection: file, line ${source.start.line} column ${source.start.column} to line ${source.end.line} column ${source.end.column}`,
        `Version: ${source.version}${source.unsaved ? " (with unsaved edits)" : ""}`,
      );
    } else {
      if (source.oldPath && source.oldPath !== source.path)
        where.push(`Old path: ${source.oldPath}`);
      where.push(
        `Selection: ${source.commit ? `diff of commit ${source.commit}` : `${source.area ?? "working"} diff`}, ${source.side} side`,
      );
      if (source.oldLines) where.push(`Old lines: ${source.oldLines[0]}-${source.oldLines[1]}`);
      if (source.newLines) where.push(`New lines: ${source.newLines[0]}-${source.newLines[1]}`);
    }
    const fence = longestFence(draft.snippet);
    return [
      `Comment ${index + 1}`,
      ...where,
      "Selected text:",
      `${fence}${source.kind === "diff" ? "diff" : ""}`,
      draft.snippet,
      fence,
      `Comment: ${draft.comment}`,
    ].join("\n");
  });
  return [
    "Comments the user wrote in the Exeora Workspace panel on selected code. Each names its project, workspace, path and the selected lines.",
    ...parts,
  ].join("\n\n");
}

/** A fence the snippet cannot close by itself. */
function longestFence(snippet: string): string {
  const runs = snippet.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(longest + 1);
}

export function newId(): string {
  return crypto.randomUUID();
}

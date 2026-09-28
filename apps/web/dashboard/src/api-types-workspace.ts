/**
 * The Source Control v2, Explorer and Search values, restated from
 * `@exeora/protocol` so the dashboard bundle skips zod. The schemas in
 * `packages/protocol/src/workspace-{git-v2,files,search}.ts` are the source of
 * truth; keep these in step with them.
 */

export type DiffArea = "working" | "staged";

export interface GitCommit {
  oid: string;
  shortOid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  refs: string[];
}

export interface GitLog {
  kind: "log";
  commits: GitCommit[];
  nextCursor: string | null;
  head: string | null;
  upstream: string | null;
}

export interface GitCommitFile {
  path: string;
  oldPath?: string;
  status: "A" | "M" | "D" | "R" | "C" | "T";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitCommitDetail {
  kind: "commit_detail";
  oid: string;
  message: string;
  files: GitCommitFile[];
}

export interface GitCommitDiff {
  kind: "commit_diff";
  oid: string;
  path: string | null;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export interface GitDiffAll {
  kind: "diff_all";
  area: DiffArea;
  patch: string;
  truncated: boolean;
  untrackedOmitted: boolean;
}

export interface GitRangeDiff {
  kind: "range_diff";
  base: string;
  head: string;
  mergeBase: string;
  patch: string;
  truncated: boolean;
  files: GitCommitFile[];
}

export interface GitStashEntry {
  index: number;
  message: string;
  createdAt: string;
}

export interface GitStashList {
  kind: "stash_list";
  entries: GitStashEntry[];
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  ignored: boolean;
}

export interface FileTree {
  kind: "tree";
  path: string;
  entries: FileTreeEntry[];
  truncated: boolean;
}

export interface FileContent {
  kind: "file";
  path: string;
  content: string;
  encoding: "text" | "base64";
  token: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  mime: string | null;
}

export interface FileWritten {
  kind: "file_write";
  path: string;
  status: "written" | "conflict";
  token: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  previewOffset: number;
}

export interface SearchFile {
  path: string;
  token: string;
  matches: SearchMatch[];
  truncated: boolean;
}

export interface SearchResult {
  kind: "search";
  files: SearchFile[];
  totalMatches: number;
  truncated: boolean;
  filesSearched: number;
  filesSkipped: number;
}

export interface ReplaceFile {
  path: string;
  replaced: number;
  status: "ok" | "conflict" | "missing" | "skipped";
}

export interface ReplaceResult {
  kind: "replace";
  files: ReplaceFile[];
  replaced: number;
  skipped: number;
}

export interface SearchQuery {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** What `POST …/workspace/reads` takes: nothing here changes the checkout. */
export type WorkspaceReadAction =
  | { action: "log"; cursor?: string; limit?: number }
  | { action: "commit_detail"; oid: string }
  | { action: "commit_diff"; oid: string; path?: string }
  | { action: "diff_all"; area: DiffArea }
  | { action: "range_diff"; base: string }
  | { action: "stash_list" }
  | { action: "tree"; path?: string; showIgnored?: boolean }
  | { action: "file_read"; path: string; encoding?: "text" | "base64" }
  | ({
      action: "search";
      include?: string;
      exclude?: string;
      includeIgnored?: boolean;
      path?: string;
      maxResults?: number;
      maxPerFile?: number;
    } & SearchQuery);

/** The v2 mutations, sent to the same `…/workspace/actions` route as the v1 ones. */
export type WorkspaceActionV2 =
  | { action: "amend"; message?: string }
  | { action: "stash_push"; message?: string; includeUntracked?: boolean }
  | { action: "stash_pop"; index?: number }
  | { action: "stash_drop"; index: number }
  | { action: "sync"; remote?: string }
  | { action: "discard_all" }
  | {
      action: "file_write";
      path: string;
      content: string;
      expectedToken?: string;
      create?: boolean;
    }
  | { action: "file_create"; path: string; type: "file" | "directory" }
  | { action: "file_rename"; from: string; to: string; overwrite?: boolean }
  | { action: "file_move"; paths: string[]; to: string; overwrite?: boolean }
  | { action: "file_delete"; paths: string[] }
  | { action: "file_duplicate"; path: string }
  | ({
      action: "replace";
      replacement: string;
      preserveCase?: boolean;
      targets: { path: string; token: string; lines?: number[] }[];
    } & SearchQuery);

export type WorkspaceReadValue =
  | GitLog
  | GitCommitDetail
  | GitCommitDiff
  | GitDiffAll
  | GitRangeDiff
  | GitStashList
  | FileTree
  | FileContent
  | SearchResult;

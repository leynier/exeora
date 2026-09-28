import { request } from "./api.js";
import type {
  FileContent,
  FileTree,
  GitCommitDetail,
  GitCommitDiff,
  GitDiffAll,
  GitLog,
  GitRangeDiff,
  GitStashList,
  SearchResult,
  WorkspaceReadAction,
  WorkspaceReadValue,
} from "./api-types-workspace.js";

/**
 * The reads a workspace answers beyond status and a file's diff: history,
 * a commit, aggregate patches, the tree, a file, a search. One route takes
 * them all, as a body rather than a query string, since a search is a small
 * form of its own.
 */
export function workspaceRead<A extends WorkspaceReadAction>(
  projectId: string,
  action: A,
  workspace?: string,
  signal?: AbortSignal,
): Promise<ReadValueOf<A["action"]>> {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  };
  if (signal) init.signal = signal;
  return request<ReadValueOf<A["action"]>>(
    `/api/projects/${projectId}/workspace/reads${query}`,
    init,
  );
}

type ReadValueOf<Name extends WorkspaceReadAction["action"]> = Name extends "log"
  ? GitLog
  : Name extends "commit_detail"
    ? GitCommitDetail
    : Name extends "commit_diff"
      ? GitCommitDiff
      : Name extends "diff_all"
        ? GitDiffAll
        : Name extends "range_diff"
          ? GitRangeDiff
          : Name extends "stash_list"
            ? GitStashList
            : Name extends "tree"
              ? FileTree
              : Name extends "file_read"
                ? FileContent
                : Name extends "search"
                  ? SearchResult
                  : WorkspaceReadValue;

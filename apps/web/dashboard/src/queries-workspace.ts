import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import type { DiffArea, SearchQuery } from "./api-types-workspace.js";
import { workspaceRead } from "./api-workspace.js";

/**
 * The Source Control v2, Explorer and Search queries, keyed under the same
 * `["workspace", project, target, …]` prefix as status and a file's diff.
 * A mutation invalidates `reads`, and everything here is under it, so a
 * commit refreshes the history and a save refreshes the tree without either
 * naming the other.
 */
export const workspaceKeys = {
  reads: (id: string, target: string) => ["workspace", id, target, "reads"] as const,
  log: (id: string, target: string) => ["workspace", id, target, "reads", "log"] as const,
  commit: (id: string, target: string, oid: string) =>
    ["workspace", id, target, "reads", "commit", oid] as const,
  commitDiff: (id: string, target: string, oid: string, path: string | null) =>
    ["workspace", id, target, "reads", "commit_diff", oid, path] as const,
  /** The whole tree's diffs of both areas, for a refresh to cover at once. */
  diffAlls: (id: string, target: string) => ["workspace", id, target, "reads", "diff_all"] as const,
  diffAll: (id: string, target: string, area: DiffArea) =>
    ["workspace", id, target, "reads", "diff_all", area] as const,
  rangeDiff: (id: string, target: string, base: string) =>
    ["workspace", id, target, "reads", "range_diff", base] as const,
  stashes: (id: string, target: string) => ["workspace", id, target, "reads", "stashes"] as const,
  tree: (id: string, target: string, path: string, showIgnored: boolean) =>
    ["workspace", id, target, "reads", "tree", path, showIgnored] as const,
  file: (id: string, target: string, path: string) =>
    ["workspace", id, target, "reads", "file", path] as const,
  search: (id: string, target: string, input: SearchInput) =>
    ["workspace", id, target, "reads", "search", input] as const,
  /** Every file diff of the working copy, for a refresh to cover at once. */
  diffs: (id: string, target: string) => ["workspace", id, target, "diff"] as const,
  fileDiff: (id: string, target: string, path: string, area: DiffArea) =>
    ["workspace", id, target, "diff", path, area] as const,
};

export type Target = { projectId: string; workspace: string | undefined; targetKey: string };

export const HISTORY_PAGE = 30;

export const useGitLog = (target: Target, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: workspaceKeys.log(target.projectId, target.targetKey),
    queryFn: ({ pageParam, signal }) =>
      workspaceRead(
        target.projectId,
        pageParam
          ? { action: "log", cursor: pageParam, limit: HISTORY_PAGE }
          : { action: "log", limit: HISTORY_PAGE },
        target.workspace,
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });

export const useCommitDetail = (target: Target, oid: string) =>
  useQuery({
    queryKey: workspaceKeys.commit(target.projectId, target.targetKey, oid),
    queryFn: ({ signal }) =>
      workspaceRead(target.projectId, { action: "commit_detail", oid }, target.workspace, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useCommitDiff = (target: Target, oid: string, path: string | null) =>
  useQuery({
    queryKey: workspaceKeys.commitDiff(target.projectId, target.targetKey, oid, path),
    queryFn: ({ signal }) =>
      workspaceRead(
        target.projectId,
        path ? { action: "commit_diff", oid, path } : { action: "commit_diff", oid },
        target.workspace,
        signal,
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });

// The patches on screen move with the status, by the git client's own
// refresh, never alone on a focus: the list and the patch would disagree.
export const useDiffAll = (target: Target, area: DiffArea) =>
  useQuery({
    queryKey: workspaceKeys.diffAll(target.projectId, target.targetKey, area),
    queryFn: ({ signal }) =>
      workspaceRead(target.projectId, { action: "diff_all", area }, target.workspace, signal),
    refetchOnWindowFocus: false,
  });

export const useRangeDiff = (target: Target, base: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.rangeDiff(target.projectId, target.targetKey, base),
    queryFn: ({ signal }) =>
      workspaceRead(target.projectId, { action: "range_diff", base }, target.workspace, signal),
    enabled: enabled && base.length > 0,
  });

export const useFileDiff = (target: Target, path: string, area: DiffArea, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.fileDiff(target.projectId, target.targetKey, path, area),
    queryFn: ({ signal }) => api.gitDiff(target.projectId, path, area, target.workspace, signal),
    enabled,
    refetchOnWindowFocus: false,
  });

export const useStashes = (target: Target, enabled: boolean) =>
  useQuery({
    queryKey: workspaceKeys.stashes(target.projectId, target.targetKey),
    queryFn: ({ signal }) =>
      workspaceRead(target.projectId, { action: "stash_list" }, target.workspace, signal),
    enabled,
  });

export const useFileTree = (target: Target, path: string, showIgnored: boolean, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.tree(target.projectId, target.targetKey, path, showIgnored),
    queryFn: ({ signal }) =>
      workspaceRead(
        target.projectId,
        { action: "tree", path, showIgnored },
        target.workspace,
        signal,
      ),
    enabled,
  });

export const useFileContent = (
  target: Target,
  path: string,
  encoding: "text" | "base64" = "text",
) =>
  useQuery({
    queryKey: workspaceKeys.file(target.projectId, target.targetKey, path),
    queryFn: ({ signal }) =>
      workspaceRead(
        target.projectId,
        { action: "file_read", path, encoding },
        target.workspace,
        signal,
      ),
    // A file is re-read when its editor asks, not on a timer under someone's edits.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

export type SearchInput = SearchQuery & {
  include?: string;
  exclude?: string;
  includeIgnored?: boolean;
};

export const useSearch = (target: Target, input: SearchInput, enabled: boolean) =>
  useQuery({
    queryKey: workspaceKeys.search(target.projectId, target.targetKey, input),
    queryFn: ({ signal }) =>
      workspaceRead(target.projectId, { action: "search", ...input }, target.workspace, signal),
    enabled: enabled && input.query.trim().length > 0,
    placeholderData: (previous) => previous,
  });

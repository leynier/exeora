import { z } from "zod";
import { PROJECT_CLONE_FEATURE } from "./repository.js";
import { WORKSPACE_V1_READ_ACTIONS, type WorkspaceAction } from "./workspace.js";
import { FILE_READ_ACTIONS } from "./workspace-files.js";
import { GIT_V2_READ_ACTIONS } from "./workspace-git-v2.js";
import { SEARCH_READ_ACTIONS } from "./workspace-search.js";

/**
 * Which CLI can run which workspace action.
 *
 * A CLI announces features in `hello.capabilities.features`, and the relay
 * refuses an action the connected CLI never announced, naming the dashboard
 * tab that needs a newer CLI. Each tab degrades on its own: an old CLI keeps
 * serving Source Control v1 while the Explorer says it needs an update.
 */

/** Status, diff, stage, commit, branches, fetch, pull, push, worktrees. */
export const SOURCE_CONTROL_V1 = "source-control-v1";
/** History, aggregate diffs, assistant context, amend, stash, sync, discard all. */
export const SOURCE_CONTROL_V2 = "source-control-v2";
/** The Explorer and search: tree, file reads and edits, search and replace. */
export const WORKSPACE_V2 = "workspace-v2";

export const WORKSPACE_ACTION_FEATURES: Record<WorkspaceAction["action"], string> = {
  status: SOURCE_CONTROL_V1,
  diff: SOURCE_CONTROL_V1,
  unpublished: SOURCE_CONTROL_V1,
  stage: SOURCE_CONTROL_V1,
  unstage: SOURCE_CONTROL_V1,
  discard: SOURCE_CONTROL_V1,
  delete_untracked: SOURCE_CONTROL_V1,
  commit: SOURCE_CONTROL_V1,
  fetch: SOURCE_CONTROL_V1,
  pull: SOURCE_CONTROL_V1,
  push: SOURCE_CONTROL_V1,
  branch_create: SOURCE_CONTROL_V1,
  branch_switch: SOURCE_CONTROL_V1,
  branch_track: SOURCE_CONTROL_V1,
  branch_delete: SOURCE_CONTROL_V1,
  workspace_create: SOURCE_CONTROL_V1,
  project_prepare: PROJECT_CLONE_FEATURE,
  log: SOURCE_CONTROL_V2,
  commit_detail: SOURCE_CONTROL_V2,
  commit_diff: SOURCE_CONTROL_V2,
  diff_all: SOURCE_CONTROL_V2,
  range_diff: SOURCE_CONTROL_V2,
  staged_context: SOURCE_CONTROL_V2,
  range_context: SOURCE_CONTROL_V2,
  amend: SOURCE_CONTROL_V2,
  stash_push: SOURCE_CONTROL_V2,
  stash_pop: SOURCE_CONTROL_V2,
  stash_drop: SOURCE_CONTROL_V2,
  stash_list: SOURCE_CONTROL_V2,
  sync: SOURCE_CONTROL_V2,
  discard_all: SOURCE_CONTROL_V2,
  tree: WORKSPACE_V2,
  file_read: WORKSPACE_V2,
  file_write: WORKSPACE_V2,
  file_create: WORKSPACE_V2,
  file_rename: WORKSPACE_V2,
  file_move: WORKSPACE_V2,
  file_delete: WORKSPACE_V2,
  file_duplicate: WORKSPACE_V2,
  search: WORKSPACE_V2,
  replace: WORKSPACE_V2,
};

/** The feature a CLI must have announced to be sent this action. */
export function requiredFeature(action: WorkspaceAction["action"]): string {
  return WORKSPACE_ACTION_FEATURES[action];
}

export type WorkspaceTab = "Source Control" | "Explorer" | "Search";

/** The dashboard tab an action belongs to, for a refusal to name. */
export function workspaceTab(action: WorkspaceAction["action"]): WorkspaceTab {
  if (action === "search" || action === "replace") return "Search";
  if (action === "tree" || action.startsWith("file_")) return "Explorer";
  return "Source Control";
}

/**
 * The reads: what `POST …/workspace/reads` takes, unaudited and outside the
 * write rate limit. Everything else is a mutation and goes through
 * `POST …/workspace/actions`, which audits it.
 */
export const WorkspaceReadAction = z.discriminatedUnion("action", [
  ...WORKSPACE_V1_READ_ACTIONS,
  ...GIT_V2_READ_ACTIONS,
  ...FILE_READ_ACTIONS,
  ...SEARCH_READ_ACTIONS,
]);

export type WorkspaceReadAction = z.infer<typeof WorkspaceReadAction>;

export const WORKSPACE_READ_ACTIONS: ReadonlySet<string> = new Set(
  WorkspaceReadAction.options.map((option) => option.shape.action.value),
);

/** Whether an action is a read, and so never audited or rate limited as a write. */
export function isWorkspaceRead(action: string): action is WorkspaceReadAction["action"] {
  return WORKSPACE_READ_ACTIONS.has(action);
}

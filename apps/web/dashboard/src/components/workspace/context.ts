import type { UseQueryResult } from "@tanstack/react-query";
import type {
  GitStatus,
  Project,
  ProjectLocation,
  Workspace,
  WorkspaceCapabilities,
} from "../../api.js";
import type { Target } from "../../queries-workspace.js";
import type { LocationRoot } from "../../workspacePaths.js";
import type { AutoRefresh } from "./useAutoRefresh.js";
import type { useWorkspaceActions } from "./useWorkspaceActions.js";
import type { Detail } from "./workspaceLayout.js";

/**
 * What every view and every detail of the Workspace screen reads: the
 * project and the working copy on screen, its status, what the machine can
 * do, the actions, and how to open something.
 */
export type WorkspaceContext = {
  project: Project;
  target: Target;
  targetLabel: string;
  /** The location of what is on screen. */
  home: ProjectLocation | undefined;
  /** The workspaces on the same machine, for the branch picker. */
  siblings: Workspace[];
  root: LocationRoot;
  rootPath: string;
  status: UseQueryResult<GitStatus>;
  capabilities: WorkspaceCapabilities | undefined;
  actions: ReturnType<typeof useWorkspaceActions>;
  /** The git client's polling: on or off, and a refresh by hand. */
  refresh: AutoRefresh;
  /** Opens a detail beside the list on a wide screen, over it on a narrow one. */
  open: (detail: Detail, pin?: boolean) => void;
  /** What is open, for the list to highlight. */
  selected: Detail | null;
  /** An editor says whether the tab it is in holds unsaved edits. */
  setDirty: (detail: Detail, dirty: boolean) => void;
  /** The files whose editors hold unsaved edits, which a replace must not write. */
  dirtyPaths: ReadonlySet<string>;
  wide: boolean;
  onSelectWorkspace: (slug: string | null) => void;
};

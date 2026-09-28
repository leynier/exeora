import { IconButton } from "@exeora/design/react";
import {
  ArrowDownToLine,
  Download,
  FileDiff,
  GitGraph,
  List,
  ListTree,
  RefreshCw,
  Repeat,
  Upload,
} from "lucide-react";
import type { GitStatus, Workspace, WorkspaceAction } from "../../api.js";
import type { LocationRoot } from "../../workspacePaths.js";
import { SourceControlBranchPicker } from "../SourceControlBranchPicker.js";

/**
 * The branch, then the icons: fetch, pull with what is behind, push with
 * what is ahead, a refresh by hand and the polling toggle, and the toggles
 * for the history, tree or flat lists and the whole diff. Each says its name
 * on hover or focus.
 */
export function SourceControlToolbar({
  status,
  pending,
  root,
  workspaces,
  v2,
  tree,
  history,
  refreshing,
  autoRefresh,
  onRun,
  onRefresh,
  onAutoRefreshChange,
  onToggleTree,
  onToggleHistory,
  onAllChanges,
  onSelectWorkspace,
  onCreateWorkspace,
  onConfirmDelete,
}: {
  status: GitStatus;
  pending: boolean;
  root: LocationRoot;
  workspaces: Workspace[];
  v2: boolean;
  tree: boolean;
  history: boolean;
  refreshing: boolean;
  /** The list and the open diff are read again every few seconds. */
  autoRefresh: boolean;
  onRun: (action: WorkspaceAction) => Promise<void>;
  onRefresh: () => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onToggleTree: () => void;
  onToggleHistory: () => void;
  onAllChanges: () => void;
  onSelectWorkspace: (slug: string | null) => void;
  onCreateWorkspace: (branch: string) => void;
  onConfirmDelete: (name: string) => void;
}) {
  const publish = !status.upstream && status.remotes[0] !== undefined;
  return (
    <header className="border-border-subtle flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <SourceControlBranchPicker
          status={status}
          pending={pending}
          root={root}
          workspaces={workspaces}
          onRun={onRun}
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onConfirmDelete={onConfirmDelete}
        />
        {status.operation ? (
          <span className="text-label-md text-error font-mono uppercase">{status.operation}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Fetch from every remote"
          icon={ArrowDownToLine}
          size="sm"
          disabled={pending}
          onClick={() => void onRun({ action: "fetch", all: true })}
        />
        <IconButton
          label={status.behind > 0 ? `Pull ${status.behind} commits` : "Pull"}
          icon={Download}
          size="sm"
          badge={status.behind > 0 ? status.behind : undefined}
          disabled={pending}
          onClick={() => void onRun({ action: "pull" })}
        />
        <IconButton
          label={
            publish ? "Publish branch" : status.ahead > 0 ? `Push ${status.ahead} commits` : "Push"
          }
          icon={Upload}
          size="sm"
          badge={status.ahead > 0 ? status.ahead : undefined}
          disabled={pending}
          onClick={() =>
            void onRun(
              publish
                ? { action: "push", remote: status.remotes[0] as string, setUpstream: true }
                : { action: "push" },
            )
          }
        />
        <IconButton
          label="Refresh"
          icon={RefreshCw}
          size="sm"
          busy={refreshing}
          onClick={onRefresh}
        />
        <IconButton
          label="Auto refresh"
          icon={Repeat}
          size="sm"
          pressed={autoRefresh}
          onClick={() => onAutoRefreshChange(!autoRefresh)}
        />
        <span className="bg-border-subtle mx-0.5 h-4 w-px" aria-hidden="true" />
        <IconButton
          label={tree ? "Show files as a list" : "Show files as a tree"}
          icon={tree ? List : ListTree}
          size="sm"
          onClick={onToggleTree}
        />
        <IconButton
          label="Open every change as one diff"
          icon={FileDiff}
          size="sm"
          disabled={!v2 || status.files.length === 0}
          onClick={onAllChanges}
        />
        <IconButton
          label={history ? "Hide commits" : "Show commits"}
          icon={GitGraph}
          size="sm"
          pressed={history}
          disabled={!v2}
          onClick={onToggleHistory}
        />
      </div>
    </header>
  );
}

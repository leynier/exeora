import { PatchDiff } from "@pierre/diffs/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type GitStatus,
  type Project,
  type ProjectLocation,
  type Workspace,
  type WorkspaceAction,
} from "../api.js";
import { createdSlug } from "../api-projects.js";
import { keys, useMe } from "../queries.js";
import type { LocationRoot } from "../workspacePaths.js";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { SourceControlBranchPicker } from "./SourceControlBranchPicker.js";
import { useToast } from "./toast.js";
import { EmptyState, ErrorBanner, Skeleton } from "./ui.js";
import {
  defaultWorkspaceSelection,
  fileStatusClass,
  fileStatusCode,
  selectionAfterStatus,
  WorkspaceFileGroup,
  type WorkspaceSelection,
  workspaceActionLabel,
} from "./WorkspaceFileGroup.js";

export function SourceControl({
  projectId,
  workspace,
  workspaces,
  root,
  project,
  where,
  targetKey,
  targetLabel,
  status,
  loading,
  error,
  autoRefresh,
  onAutoRefreshChange,
  onSelectWorkspace,
}: {
  projectId: string;
  workspace?: string;
  workspaces: Workspace[];
  /** The root of the location on screen, which is what its git status lists. */
  root: LocationRoot;
  project: Project;
  /** The location of what is on screen, which is where a new workspace starts out. */
  where: ProjectLocation | undefined;
  targetKey: string;
  targetLabel: string;
  status?: GitStatus;
  loading: boolean;
  error: unknown;
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onSelectWorkspace: (slug: string | null) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [selected, setSelected] = useState<WorkspaceSelection | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<{
    action: WorkspaceAction;
    title: string;
    body: string;
    label: string;
  } | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState<string | null>(null);
  const chosen = selected ?? defaultWorkspaceSelection(status);
  const chosenPath = chosen?.path ?? "";
  const chosenArea = chosen?.area ?? "working";
  const diffKey = useMemo(
    () => ["workspace", projectId, targetKey, "diff", chosenPath, chosenArea] as const,
    [projectId, targetKey, chosenPath, chosenArea],
  );
  const canLoadDiff = Boolean(chosen && status?.repository);
  const diff = useQuery({
    queryKey: diffKey,
    queryFn: ({ signal }) => api.gitDiff(projectId, chosenPath, chosenArea, workspace, signal),
    enabled: canLoadDiff,
    refetchOnWindowFocus: false,
  });
  const staged = useMemo(
    () => status?.files.filter((file) => file.index !== "." && file.index !== "?") ?? [],
    [status],
  );
  const changes = useMemo(
    () => status?.files.filter((file) => file.worktree !== "." || file.kind === "untracked") ?? [],
    [status],
  );
  const chosenFile = status?.files.find((file) => file.path === chosen?.path);
  const pollGeneration = useRef(0);
  const pollController = useRef<AbortController | null>(null);
  const pollPaused = useRef(false);
  const refresh = useCallback(
    () =>
      Promise.all([
        client.invalidateQueries(
          { queryKey: keys.gitStatus(projectId, targetKey) },
          { cancelRefetch: false },
        ),
        client.invalidateQueries(
          { queryKey: ["workspace", projectId, targetKey, "diff"] },
          { cancelRefetch: false },
        ),
      ]),
    [client, projectId, targetKey],
  );

  const manualRefresh = useCallback(async () => {
    if (pollPaused.current) return;
    pollPaused.current = true;
    setRefreshing(true);
    pollGeneration.current += 1;
    pollController.current?.abort();
    try {
      await Promise.all([
        client.cancelQueries({ queryKey: keys.gitStatus(projectId, targetKey) }),
        client.cancelQueries({ queryKey: ["workspace", projectId, targetKey, "diff"] }),
      ]);
      await refresh();
    } finally {
      pollPaused.current = false;
      setRefreshing(false);
    }
  }, [client, projectId, refresh, targetKey]);

  const poll = useCallback(async () => {
    const generation = pollGeneration.current;
    const controller = new AbortController();
    pollController.current = controller;
    try {
      const [nextStatus, nextDiff] = await Promise.all([
        api.gitStatus(projectId, workspace, controller.signal),
        canLoadDiff
          ? api.gitDiff(projectId, chosenPath, chosenArea, workspace, controller.signal)
          : Promise.resolve(undefined),
      ]);
      if (controller.signal.aborted || generation !== pollGeneration.current) return;
      client.setQueryData(keys.gitStatus(projectId, targetKey), nextStatus);
      if (nextDiff) client.setQueryData(diffKey, nextDiff);
      setSelected((current) => selectionAfterStatus(current, nextStatus));
    } catch {
      // Keep the last known status and retry on the next visible tick.
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }
  }, [canLoadDiff, chosenArea, chosenPath, client, diffKey, projectId, targetKey, workspace]);

  useEffect(() => {
    if (!autoRefresh || pending || refreshing) return;
    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        try {
          if (!stopped && !pollPaused.current && document.visibilityState !== "hidden")
            await poll();
        } finally {
          if (!stopped) schedule();
        }
      }, 3_000);
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      pollController.current?.abort();
    };
  }, [autoRefresh, pending, poll, refreshing]);

  const run = async (actions: WorkspaceAction | WorkspaceAction[]) => {
    const batch = Array.isArray(actions) ? actions : [actions];
    const action = batch[0];
    if (!action) return;
    pollPaused.current = true;
    setPending(true);
    try {
      pollGeneration.current += 1;
      pollController.current?.abort();
      await Promise.all([
        client.cancelQueries({ queryKey: keys.gitStatus(projectId, targetKey) }),
        client.cancelQueries({ queryKey: ["workspace", projectId, targetKey, "diff"] }),
      ]);
      let result = await api.workspaceAction(projectId, action, workspace);
      for (const next of batch.slice(1)) {
        result = await api.workspaceAction(projectId, next, workspace);
      }
      client.setQueryData(keys.gitStatus(projectId, targetKey), result.status);
      await client.invalidateQueries({ queryKey: ["workspace", projectId, targetKey, "diff"] });
      if (action.action === "commit") setCommitMessage("");
      if (action.action.startsWith("branch_")) setSelected(null);
      else setSelected((current) => selectionAfterStatus(current, result.status));
      toast(workspaceActionLabel(action));
    } catch (runError) {
      toast(
        runError instanceof Error ? runError.message : "Source control action failed.",
        "error",
      );
    } finally {
      pollPaused.current = false;
      setPending(false);
      setConfirm(null);
    }
  };

  if (loading) return <Skeleton className="h-full w-full rounded-xl" />;
  if (error) return <ErrorBanner error={error} onRetry={() => void manualRefresh()} />;
  if (!status?.repository)
    return (
      <EmptyState title="Not a Git repository">
        Initialize Git from the terminal, then refresh this view.
      </EmptyState>
    );

  const subject = commitMessage.trim().split("\n")[0] ?? "";
  const canCommit = !pending && staged.length > 0 && subject.length > 0;

  return (
    <div className="border-border bg-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
      <header className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <SourceControlBranchPicker
            status={status}
            pending={pending}
            root={root}
            workspaces={workspaces}
            onRun={run}
            onSelectWorkspace={onSelectWorkspace}
            onCreateWorkspace={setCreatingWorkspace}
            onConfirmDelete={(name) =>
              setConfirm({
                action: { action: "branch_delete", name },
                title: "Delete local branch?",
                body: `Git will only delete ${name} if it is fully merged. Remote branches are never deleted here.`,
                label: "Delete branch",
              })
            }
          />
          {workspace ? (
            <span className="text-body-md text-foreground-faint truncate">{targetLabel}</span>
          ) : null}
          {status.operation && (
            <span className="text-label-md text-error font-mono uppercase">{status.operation}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() => void run({ action: "fetch", all: true })}
          >
            Fetch
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() => void run({ action: "pull" })}
          >
            {status.behind > 0 ? `Pull ${status.behind}` : "Pull"}
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() =>
              void run(
                status.upstream || !status.remotes[0]
                  ? { action: "push" }
                  : { action: "push", remote: status.remotes[0], setUpstream: true },
              )
            }
          >
            {status.ahead > 0 ? `Push ${status.ahead}` : "Push"}
          </button>
          <button
            className={`btn ${autoRefresh ? "btn-primary" : ""}`}
            disabled={pending}
            type="button"
            aria-pressed={autoRefresh}
            onClick={() => onAutoRefreshChange(!autoRefresh)}
          >
            Auto refresh
          </button>
          <button
            className="btn"
            disabled={pending || refreshing}
            type="button"
            onClick={() => void manualRefresh()}
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Below lg it is one column that scrolls as a whole: the commit box, every
          changed file, then the diff. Two panes sharing a narrow height, as in a
          side panel, left room for one file and a sliver of diff. */}
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[20rem_minmax(0,1fr)] lg:overflow-visible">
        <aside className="border-border-subtle flex flex-col border-b lg:min-h-0 lg:overflow-hidden lg:border-r lg:border-b-0">
          <section className="border-border-subtle shrink-0 border-b p-3">
            <label className="block">
              <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
                Commit
              </span>
              <textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                rows={4}
                placeholder="Commit message"
                className="border-border bg-bg mt-2 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs"
              />
            </label>
            <button
              type="button"
              className="btn btn-primary mt-2 w-full"
              disabled={!canCommit}
              onClick={() => void run({ action: "commit", message: commitMessage })}
            >
              {staged.length === 0
                ? "Stage files to commit"
                : `Commit ${staged.length} ${staged.length === 1 ? "file" : "files"}`}
            </button>
          </section>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <WorkspaceFileGroup
              title="Staged"
              files={staged}
              selected={chosen}
              area="staged"
              onSelect={setSelected}
              onAction={(file) => void run({ action: "unstage", paths: [file.path] })}
              actionLabel="Unstage"
              onActionAll={() => void run(inChunks("unstage", staged))}
              actionAllLabel="Unstage all"
              disabled={pending}
            />
            <WorkspaceFileGroup
              title="Changes"
              files={changes}
              selected={chosen}
              area="working"
              onSelect={setSelected}
              onAction={(file) => void run({ action: "stage", paths: [file.path] })}
              actionLabel="Stage"
              onActionAll={() => void run(inChunks("stage", changes))}
              actionAllLabel="Stage all"
              disabled={pending}
            />
          </div>
        </aside>

        <main className="bg-bg flex min-h-[32rem] min-w-0 flex-col overflow-hidden lg:min-h-0">
          {chosen ? (
            <header className="border-border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <div className="min-w-0">
                <p className="text-title-md truncate font-mono">{chosen.path}</p>
                <p className="text-label-md text-foreground-faint mt-0.5 font-mono uppercase">
                  {chosen.area === "staged" ? "Staged" : "Working tree"}
                  {chosenFile ? (
                    <span
                      className={`ml-2 ${fileStatusClass(fileStatusCode(chosenFile, chosen.area), chosenFile.kind)}`}
                    >
                      {fileStatusCode(chosenFile, chosen.area)}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex gap-2">
                {chosen.area === "working" && chosenFile?.kind === "untracked" ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={pending}
                    onClick={() =>
                      setConfirm({
                        action: { action: "delete_untracked", paths: [chosen.path] },
                        title: "Delete untracked file?",
                        body: `${chosen.path} will be permanently deleted from the machine that holds this workspace.`,
                        label: "Delete file",
                      })
                    }
                  >
                    Delete
                  </button>
                ) : chosen.area === "working" ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={pending}
                    onClick={() =>
                      setConfirm({
                        action: { action: "discard", paths: [chosen.path] },
                        title: "Discard local changes?",
                        body: `Uncommitted changes in ${chosen.path} cannot be recovered by Exeora.`,
                        label: "Discard changes",
                      })
                    }
                  >
                    Discard
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={pending}
                    onClick={() => void run({ action: "unstage", paths: [chosen.path] })}
                  >
                    Unstage
                  </button>
                )}
              </div>
            </header>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {chosen && diff.data?.patch ? (
              <div className="git-diff h-full">
                <PatchDiff
                  patch={diff.data.patch}
                  disableWorkerPool
                  options={{
                    // Pierre still follows the OS unless themeType is dark.
                    // Naming both slots pierre-dark is not enough on a light laptop.
                    theme: { dark: "pierre-dark", light: "pierre-dark" },
                    themeType: "dark",
                    disableFileHeader: true,
                    diffStyle: "unified",
                    overflow: "scroll",
                    stickyHeader: true,
                    unsafeCSS: `:host { color-scheme: dark; background: var(--color-bg, #0d0f11); }`,
                  }}
                />
              </div>
            ) : chosen && diff.isLoading ? (
              <Skeleton className="m-5 h-64 w-[calc(100%-2.5rem)]" />
            ) : (
              <EmptyState title={chosen ? "No textual diff" : "Working tree clean"}>
                {chosen
                  ? "The file may be untracked, binary, or unchanged in this area."
                  : "Stage, commit, and sync from the left, the way a git client is laid out."}
              </EmptyState>
            )}
          </div>
        </main>
      </div>
      <AddWorkspaceDialog
        open={creatingWorkspace !== null}
        project={project}
        user={me.data}
        initialBranch={creatingWorkspace ?? ""}
        // On a machine the new branch starts from what is checked out here,
        // which is what somebody branching from this view means. An instance
        // clones from the remote, which may not have this branch yet.
        initialFrom={where?.kind === "local" ? (status.head ?? "") : ""}
        initialWhere={where?.slug}
        onCancel={() => setCreatingWorkspace(null)}
        onCreated={async (result) => {
          setCreatingWorkspace(null);
          // An instance takes a minute to set up and is listed with its state
          // until then. A working copy on a machine is there already.
          if (result.status !== "ready") return;
          await client.invalidateQueries({ queryKey: keys.workspaces(projectId) });
          onSelectWorkspace(createdSlug(result));
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? "Confirm action"}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        pending={pending}
        onConfirm={() => confirm && void run(confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** The protocol caps one request at 1,000 paths; "Stage all" is not capped. */
const MAX_PATHS_PER_ACTION = 1_000;

function inChunks(action: "stage" | "unstage", files: { path: string }[]): WorkspaceAction[] {
  const actions: WorkspaceAction[] = [];
  for (let start = 0; start < files.length; start += MAX_PATHS_PER_ACTION) {
    const paths = files.slice(start, start + MAX_PATHS_PER_ACTION).map((file) => file.path);
    actions.push({ action, paths });
  }
  return actions;
}

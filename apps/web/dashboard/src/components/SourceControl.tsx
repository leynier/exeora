import { PatchDiff } from "@pierre/diffs/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type GitStatus, type WorkspaceAction } from "../api.js";
import { keys } from "../queries.js";
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
  worktree,
  targetKey,
  targetLabel,
  status,
  loading,
  error,
}: {
  projectId: string;
  worktree?: string;
  targetKey: string;
  targetLabel: string;
  status?: GitStatus;
  loading: boolean;
  error: unknown;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<WorkspaceSelection | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<{
    action: WorkspaceAction;
    title: string;
    body: string;
    label: string;
  } | null>(null);
  const chosen = selected ?? defaultWorkspaceSelection(status);
  const chosenPath = chosen?.path ?? "";
  const chosenArea = chosen?.area ?? "working";
  const diff = useQuery({
    queryKey: ["workspace", projectId, targetKey, "diff", chosenPath, chosenArea],
    queryFn: () => api.gitDiff(projectId, chosenPath, chosenArea, worktree),
    enabled: Boolean(chosen && status?.repository),
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

  const run = async (action: WorkspaceAction) => {
    setPending(true);
    try {
      const result = await api.workspaceAction(projectId, action, worktree);
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
      setPending(false);
      setConfirm(null);
    }
  };

  if (loading) return <Skeleton className="h-full w-full rounded-xl" />;
  if (error)
    return (
      <ErrorBanner
        error={error}
        onRetry={() => client.invalidateQueries({ queryKey: keys.gitStatus(projectId, targetKey) })}
      />
    );
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
          <span className="bg-success size-2 shrink-0 rounded-full" aria-hidden="true" />
          <SourceControlBranchPicker
            status={status}
            pending={pending}
            onRun={run}
            onConfirmDelete={(name) =>
              setConfirm({
                action: { action: "branch_delete", name },
                title: "Delete local branch?",
                body: `Git will only delete ${name} if it is fully merged. Remote branches are never deleted here.`,
                label: "Delete branch",
              })
            }
          />
          {targetLabel !== "main" ? (
            <span className="text-body-md text-foreground-faint truncate">{targetLabel}</span>
          ) : null}
          {status.upstream && (
            <span className="text-body-md text-foreground-faint hidden truncate font-mono sm:inline">
              {status.upstream}
            </span>
          )}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="text-label-md text-brand font-mono tabular-nums">
              ↑{status.ahead} ↓{status.behind}
            </span>
          )}
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
            className="btn"
            disabled={pending}
            type="button"
            onClick={() =>
              void client.invalidateQueries({ queryKey: keys.gitStatus(projectId, targetKey) })
            }
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="border-border-subtle flex min-h-0 flex-col overflow-hidden border-b lg:border-r lg:border-b-0">
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
              onActionAll={() =>
                void run({ action: "unstage", paths: staged.map((file) => file.path) })
              }
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
              onActionAll={() =>
                void run({ action: "stage", paths: changes.map((file) => file.path) })
              }
              actionAllLabel="Stage all"
              disabled={pending}
            />
          </div>
        </aside>

        <main className="bg-bg flex min-h-0 min-w-0 flex-col overflow-hidden">
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
                    onClick={() =>
                      setConfirm({
                        action: { action: "delete_untracked", paths: [chosen.path] },
                        title: "Delete untracked file?",
                        body: `${chosen.path} will be permanently deleted from the connected machine.`,
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
                    // Both sides are dark: Pierre otherwise follows the OS and
                    // paints a light diff on this always-dark dashboard.
                    theme: { dark: "pierre-dark", light: "pierre-dark" },
                    diffStyle: "unified",
                    overflow: "scroll",
                    stickyHeader: true,
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

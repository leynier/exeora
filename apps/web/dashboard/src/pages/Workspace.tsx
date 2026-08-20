import { PatchDiff } from "@pierre/diffs/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, type GitStatus, type WorkspaceAction } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useToast } from "../components/toast.js";
import { Badge, EmptyState, ErrorBanner, PageHeader, Skeleton } from "../components/ui.js";
import { WebTerminal } from "../components/WebTerminal.js";
import {
  defaultWorkspaceSelection,
  WorkspaceFileGroup,
  type WorkspaceSelection,
  workspaceActionLabel,
} from "../components/WorkspaceFileGroup.js";
import { WorkspaceRootSelector } from "../components/WorkspaceRootSelector.js";
import {
  keys,
  useGitStatus,
  useProjects,
  useWorkspaceCapabilities,
  useWorktrees,
} from "../queries.js";

export function Workspace() {
  const { projectId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const projects = useProjects();
  const worktrees = useWorktrees(projectId);
  const worktreeSlug = search.get("worktree");
  const selectedWorktree = worktrees.data?.find((item) => item.slug === worktreeSlug);
  const targetReady = worktreeSlug === null || selectedWorktree !== undefined;
  const targetId = selectedWorktree?.id;
  const targetKey = targetId ?? "main";
  const capabilities = useWorkspaceCapabilities(projectId, targetId, targetReady);
  const status = useGitStatus(projectId, targetId, targetReady);
  const [tab, setTab] = useState<"source" | "terminal">("source");
  const project = projects.data?.find((item) => item.id === projectId);
  const targetLabel = selectedWorktree
    ? `${selectedWorktree.slug}${selectedWorktree.branch ? ` · ${selectedWorktree.branch}` : " · detached HEAD"}`
    : "main";

  if (projects.isLoading || worktrees.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  if (!project) return <EmptyState title="Project not found" />;
  if (worktrees.isError) {
    return <ErrorBanner error={worktrees.error} onRetry={() => worktrees.refetch()} />;
  }
  if (!targetReady) {
    return (
      <>
        <PageHeader
          title="Workspace unavailable"
          subtitle={`Worktree ${worktreeSlug} is no longer connected.`}
        />
        <EmptyState title="That worktree is unavailable">
          <Link className="underline" to={`/projects/${project.id}/workspace`}>
            Open the main worktree
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle={selectedWorktree?.localPath ?? project.localPath}
        action={
          <WorkspaceRootSelector
            projectId={project.id}
            worktrees={worktrees.data ?? []}
            selectedSlug={worktreeSlug}
            onSelect={(slug) => setSearch(slug === null ? {} : { worktree: slug })}
          />
        }
      />
      <div className="mb-4 flex items-center gap-1 border-b border-border">
        {(["source", "terminal"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-3 text-title-md ${tab === value ? "border-brand text-foreground" : "border-transparent text-foreground-faint"}`}
          >
            {value === "source" ? "Source Control" : "Terminal"}
          </button>
        ))}
      </div>
      {tab === "terminal" ? (
        <WebTerminal
          key={targetKey}
          projectId={projectId}
          worktree={targetId}
          targetLabel={targetLabel}
          available={capabilities.data?.terminal === true}
        />
      ) : capabilities.isError ? (
        <ErrorBanner error={capabilities.error} onRetry={() => capabilities.refetch()} />
      ) : capabilities.data && !capabilities.data.sourceControl ? (
        <EmptyState title={capabilities.data.online ? "CLI update required" : "Machine offline"}>
          {capabilities.data.online
            ? "Update the Exeora CLI to enable Source Control."
            : "Connect the machine that serves this project."}
        </EmptyState>
      ) : (
        <SourceControl
          key={targetKey}
          projectId={projectId}
          worktree={targetId}
          targetKey={targetKey}
          targetLabel={targetLabel}
          status={status.data}
          loading={status.isLoading}
          error={status.error}
        />
      )}
    </>
  );
}

function SourceControl({
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
  const [branchName, setBranchName] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [deleteBranch, setDeleteBranch] = useState("");
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

  const run = async (action: WorkspaceAction) => {
    setPending(true);
    try {
      const result = await api.workspaceAction(projectId, action, worktree);
      client.setQueryData(keys.gitStatus(projectId, targetKey), result.status);
      await client.invalidateQueries({ queryKey: ["workspace", projectId, targetKey, "diff"] });
      if (action.action === "commit") setCommitMessage("");
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

  if (loading) return <Skeleton className="h-[34rem] w-full rounded-xl" />;
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

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 font-mono text-sm">
          <Badge tone="neutral">{targetLabel}</Badge>
          <span className="text-foreground">{status.head ?? "detached HEAD"}</span>
          {status.upstream && (
            <span className="truncate text-foreground-faint">↗ {status.upstream}</span>
          )}
          {(status.ahead > 0 || status.behind > 0) && (
            <Badge tone="brand">
              ↑{status.ahead} ↓{status.behind}
            </Badge>
          )}
          {status.operation && <Badge tone="error">{status.operation}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() => run({ action: "fetch", all: true })}
          >
            Fetch
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() => run({ action: "pull" })}
          >
            Pull
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() =>
              run(
                status.upstream || !status.remotes[0]
                  ? { action: "push" }
                  : { action: "push", remote: status.remotes[0], setUpstream: true },
              )
            }
          >
            Push
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            onClick={() =>
              client.invalidateQueries({ queryKey: keys.gitStatus(projectId, targetKey) })
            }
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="grid min-h-[38rem] xl:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <aside className="border-b border-border-subtle xl:border-r xl:border-b-0">
          <WorkspaceFileGroup
            title="Staged"
            files={staged}
            selected={chosen}
            area="staged"
            onSelect={setSelected}
            onAction={(file) => run({ action: "unstage", paths: [file.path] })}
            actionLabel="Unstage"
          />
          <WorkspaceFileGroup
            title="Changes"
            files={changes}
            selected={chosen}
            area="working"
            onSelect={setSelected}
            onAction={(file) => run({ action: "stage", paths: [file.path] })}
            actionLabel="Stage"
          />
        </aside>

        <main className="min-w-0 bg-bg">
          {chosen && diff.data?.patch ? (
            <PatchDiff
              patch={diff.data.patch}
              disableWorkerPool
              options={{
                theme: { dark: "github-dark", light: "github-light" },
                diffStyle: "unified",
                overflow: "scroll",
                stickyHeader: true,
              }}
            />
          ) : chosen && diff.isLoading ? (
            <Skeleton className="m-5 h-64 w-[calc(100%-2.5rem)]" />
          ) : (
            <EmptyState title={chosen ? "No textual diff" : "Working tree clean"}>
              {chosen
                ? "The file may be untracked, binary, or unchanged in this area."
                : "Changes on the connected machine will appear here."}
            </EmptyState>
          )}
        </main>

        <aside className="space-y-5 border-t border-border-subtle p-4 xl:border-t-0 xl:border-l">
          <section>
            <h2 className="font-mono text-xs uppercase tracking-wide text-foreground-faint">
              Commit staged
            </h2>
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={5}
              placeholder="Describe this change"
              className="mt-2 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-body-md"
            />
            <button
              type="button"
              className="btn btn-primary mt-2 w-full"
              disabled={pending || staged.length === 0 || commitMessage.trim().length === 0}
              onClick={() => run({ action: "commit", message: commitMessage })}
            >
              Commit {staged.length || ""}
            </button>
          </section>

          {chosen && (
            <section className="border-t border-border-subtle pt-4">
              <p className="break-all font-mono text-xs text-foreground-muted">{chosen.path}</p>
              <div className="mt-3 grid gap-2">
                {chosen.area === "working" &&
                status.files.find((file) => file.path === chosen.path)?.kind === "untracked" ? (
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
                    Delete untracked
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
                    Discard changes
                  </button>
                ) : null}
              </div>
            </section>
          )}

          <section className="border-t border-border-subtle pt-4">
            <h2 className="font-mono text-xs uppercase tracking-wide text-foreground-faint">
              Branches
            </h2>
            <select
              value={status.head ?? ""}
              onChange={(event) => run({ action: "branch_switch", name: event.target.value })}
              className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-body-md"
              disabled={pending}
            >
              {status.branches
                .filter((branch) => !branch.remote)
                .map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
            </select>
            <div className="mt-2 flex gap-2">
              <input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="new-branch"
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                className="btn"
                disabled={pending || !branchName.trim()}
                onClick={() =>
                  run({ action: "branch_create", name: branchName.trim() }).then(() =>
                    setBranchName(""),
                  )
                }
              >
                Create
              </button>
            </div>
            {status.branches.some((branch) => branch.remote) && (
              <div className="mt-2 flex gap-2">
                <select
                  value={remoteBranch}
                  onChange={(event) => setRemoteBranch(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs"
                >
                  <option value="">Track remote…</option>
                  {status.branches
                    .filter((branch) => branch.remote)
                    .map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={pending || !remoteBranch}
                  onClick={() =>
                    run({
                      action: "branch_track",
                      remoteBranch,
                      name: remoteBranch.split("/").slice(1).join("/"),
                    })
                  }
                >
                  Track
                </button>
              </div>
            )}
            {status.branches.filter((branch) => !branch.remote && !branch.current).length > 0 && (
              <div className="mt-2 flex gap-2">
                <select
                  value={deleteBranch}
                  onChange={(event) => setDeleteBranch(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs"
                >
                  <option value="">Delete local…</option>
                  {status.branches
                    .filter((branch) => !branch.remote && !branch.current)
                    .map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={pending || !deleteBranch}
                  onClick={() =>
                    setConfirm({
                      action: { action: "branch_delete", name: deleteBranch },
                      title: "Delete local branch?",
                      body: `Git will only delete ${deleteBranch} if it is fully merged. Remote branches are never deleted here.`,
                      label: "Delete branch",
                    })
                  }
                >
                  Delete
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? "Confirm action"}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        pending={pending}
        onConfirm={() => confirm && run(confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

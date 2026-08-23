import { useEffect, useMemo } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { SourceControl } from "../components/SourceControl.js";
import { EmptyState, ErrorBanner, Skeleton } from "../components/ui.js";
import { WorkspaceRootSelector } from "../components/WorkspaceRootSelector.js";
import { WorkspaceTerminals } from "../components/WorkspaceTerminals.js";
import { useGitStatus, useProjects, useWorkspaceCapabilities, useWorktrees } from "../queries.js";
import { projectRootBranch } from "../workspacePaths.js";

const LAST_KEY = "exeora.last_workspace";

type LastWorkspace = { projectId: string; worktree: string | null };

function readLast(): LastWorkspace | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastWorkspace;
    if (typeof parsed.projectId !== "string") return null;
    return {
      projectId: parsed.projectId,
      worktree: typeof parsed.worktree === "string" ? parsed.worktree : null,
    };
  } catch {
    return null;
  }
}

function writeLast(value: LastWorkspace) {
  localStorage.setItem(LAST_KEY, JSON.stringify(value));
}

/**
 * Old project-scoped URLs still open the same pane, now under the Workspace tab.
 */
export function WorkspaceRedirect() {
  const { projectId = "" } = useParams();
  const [search] = useSearchParams();
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  const worktree = search.get("worktree");
  if (worktree) params.set("worktree", worktree);
  return <Navigate to={{ pathname: "/workspace", search: params.toString() }} replace />;
}

export function Workspace() {
  const [search, setSearch] = useSearchParams();
  const projects = useProjects();
  const projectId = search.get("project") ?? "";
  const worktreeSlug = search.get("worktree");
  const worktrees = useWorktrees(projectId || undefined);
  const tab = search.get("view") === "terminal" ? "terminal" : "source";
  const setTab = (value: "source" | "terminal") => {
    const params = new URLSearchParams(search);
    if (value === "terminal") params.set("view", "terminal");
    else params.delete("view");
    setSearch(params, { replace: true });
  };

  const project = projects.data?.find((item) => item.id === projectId);
  const selectedWorktree = worktrees.data?.find((item) => item.slug === worktreeSlug);
  const targetReady = worktreeSlug === null || selectedWorktree !== undefined;
  const targetId = selectedWorktree?.id;
  const targetKey = targetId ?? "main";
  const ready = Boolean(project) && targetReady;
  const capabilities = useWorkspaceCapabilities(projectId, targetId, ready);
  const status = useGitStatus(projectId, targetId, ready);
  const targetLabel = selectedWorktree?.slug ?? "project root";

  const restored = useMemo(() => {
    if (projectId || !projects.data) return null;
    const last = readLast();
    if (last && projects.data.some((item) => item.id === last.projectId)) return last;
    const only = projects.data.at(0);
    if (projects.data.length === 1 && only) return { projectId: only.id, worktree: null };
    return null;
  }, [projectId, projects.data]);

  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    params.set("project", restored.projectId);
    if (restored.worktree) params.set("worktree", restored.worktree);
    setSearch(params, { replace: true });
  }, [restored, setSearch]);

  const select = (nextProject: string, nextWorktree: string | null) => {
    const params = new URLSearchParams();
    if (nextProject) params.set("project", nextProject);
    if (nextWorktree) params.set("worktree", nextWorktree);
    if (tab === "terminal") params.set("view", "terminal");
    setSearch(params, { replace: true });
    if (nextProject) writeLast({ projectId: nextProject, worktree: nextWorktree });
  };

  if (projects.isLoading) {
    return <Skeleton className="h-full w-full rounded-xl" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-headline-md">Workspace</h1>
          <p className="text-body-md text-foreground-muted mt-1 truncate font-mono">
            {selectedWorktree?.localPath ??
              project?.localPath ??
              "Choose a project to open its git client."}
          </p>
        </div>
        <WorkspaceRootSelector
          projects={projects.data ?? []}
          projectId={project?.id ?? ""}
          worktrees={worktrees.data ?? []}
          selectedSlug={worktreeSlug}
          projectRootBranch={projectRootBranch(
            status.data?.gitWorktrees,
            project?.localPath ?? "",
            worktrees.data ?? [],
          )}
          onSelectProject={(id) => select(id, null)}
          onSelectWorktree={(slug) => select(projectId, slug)}
        />
      </header>

      {!project ? (
        <div className="border-border bg-surface flex-1 rounded-xl border">
          <EmptyState title={projects.data?.length ? "Select a project" : "No projects yet"}>
            {projects.data?.length
              ? "The dropdowns above switch project and worktree without leaving this tab."
              : "Add one from the CLI, then it will appear in the project selector."}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="border-border mb-3 flex shrink-0 items-center gap-1 border-b">
            {(["source", "terminal"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`text-title-md border-b-2 px-4 py-2.5 ${
                  tab === value
                    ? "border-brand text-foreground"
                    : "text-foreground-faint border-transparent"
                }`}
              >
                {value === "source" ? "Source Control" : "Terminal"}
              </button>
            ))}
          </div>
          <WorkspaceTerminals
            projectId={projectId}
            worktreeId={targetId}
            worktreeSlug={worktreeSlug}
            targetLabel={targetLabel}
            available={capabilities.data?.terminal === true}
            visible={tab === "terminal"}
          />
          {tab === "terminal" ? null : worktrees.isLoading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : worktrees.isError ? (
            <ErrorBanner error={worktrees.error} onRetry={() => worktrees.refetch()} />
          ) : !targetReady ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              <EmptyState title="That worktree is unavailable">
                Worktree {worktreeSlug} is no longer connected.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => select(project.id, null)}
                >
                  Open the project root
                </button>
                .
              </EmptyState>
            </div>
          ) : capabilities.isError ? (
            <ErrorBanner error={capabilities.error} onRetry={() => capabilities.refetch()} />
          ) : capabilities.data && !capabilities.data.sourceControl ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              <EmptyState
                title={capabilities.data.online ? "CLI update required" : "Machine offline"}
              >
                {capabilities.data.online
                  ? "Update the Exeora CLI to enable Source Control."
                  : "Connect the machine that serves this project."}
              </EmptyState>
            </div>
          ) : (
            <SourceControl
              key={targetKey}
              projectId={projectId}
              worktree={targetId}
              worktrees={worktrees.data ?? []}
              projectLocalPath={project.localPath}
              targetKey={targetKey}
              targetLabel={targetLabel}
              status={status.data}
              loading={status.isLoading}
              error={status.error}
              onSelectWorktree={(slug) => select(projectId, slug)}
            />
          )}
        </>
      )}
    </div>
  );
}

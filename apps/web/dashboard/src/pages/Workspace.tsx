import { useEffect, useMemo } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { SourceControl } from "../components/SourceControl.js";
import { EmptyState, ErrorBanner, Skeleton } from "../components/ui.js";
import { WorkspaceRootSelector } from "../components/WorkspaceRootSelector.js";
import { WorkspaceTerminals } from "../components/WorkspaceTerminals.js";
import { useGitStatus, useProjects, useWorkspaceCapabilities, useWorkspaces } from "../queries.js";
import { projectRootBranch } from "../workspacePaths.js";

const LAST_KEY = "exeora.last_workspace";

type LastWorkspace = { projectId: string; workspace: string | null };

function readLast(): LastWorkspace | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastWorkspace;
    if (typeof parsed.projectId !== "string") return null;
    return {
      projectId: parsed.projectId,
      workspace: typeof parsed.workspace === "string" ? parsed.workspace : null,
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
  const workspace = search.get("workspace");
  if (workspace) params.set("workspace", workspace);
  return <Navigate to={{ pathname: "/workspace", search: params.toString() }} replace />;
}

export function Workspace() {
  const [search, setSearch] = useSearchParams();
  const projects = useProjects();
  const projectId = search.get("project") ?? "";
  const workspaceSlug = search.get("workspace");
  const workspaces = useWorkspaces(projectId || undefined);
  const tab = search.get("view") === "terminal" ? "terminal" : "source";
  const setTab = (value: "source" | "terminal") => {
    const params = new URLSearchParams(search);
    if (value === "terminal") params.set("view", "terminal");
    else params.delete("view");
    setSearch(params, { replace: true });
  };

  const project = projects.data?.find((item) => item.id === projectId);
  const selectedWorkspace = workspaces.data?.find((item) => item.slug === workspaceSlug);
  const targetReady = workspaceSlug === null || selectedWorkspace !== undefined;
  const targetId = selectedWorkspace?.id;
  const targetKey = targetId ?? "main";
  const ready = Boolean(project) && targetReady;
  const capabilities = useWorkspaceCapabilities(projectId, targetId, ready);
  const status = useGitStatus(projectId, targetId, ready);
  const targetLabel = selectedWorkspace?.slug ?? "project root";

  const restored = useMemo(() => {
    if (projectId || !projects.data) return null;
    const last = readLast();
    if (last && projects.data.some((item) => item.id === last.projectId)) return last;
    const only = projects.data.at(0);
    if (projects.data.length === 1 && only) return { projectId: only.id, workspace: null };
    return null;
  }, [projectId, projects.data]);

  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    params.set("project", restored.projectId);
    if (restored.workspace) params.set("workspace", restored.workspace);
    setSearch(params, { replace: true });
  }, [restored, setSearch]);

  const select = (nextProject: string, nextWorkspace: string | null) => {
    const params = new URLSearchParams();
    if (nextProject) params.set("project", nextProject);
    if (nextWorkspace) params.set("workspace", nextWorkspace);
    if (tab === "terminal") params.set("view", "terminal");
    setSearch(params, { replace: true });
    if (nextProject) writeLast({ projectId: nextProject, workspace: nextWorkspace });
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
            {selectedWorkspace?.localPath ??
              project?.localPath ??
              "Choose a project to open its git client."}
          </p>
        </div>
        <WorkspaceRootSelector
          projects={projects.data ?? []}
          projectId={project?.id ?? ""}
          workspaces={workspaces.data ?? []}
          selectedSlug={workspaceSlug}
          projectRootBranch={projectRootBranch(
            status.data?.gitWorkspaces,
            project?.localPath ?? "",
            workspaces.data ?? [],
          )}
          onSelectProject={(id) => select(id, null)}
          onSelectWorkspace={(slug) => select(projectId, slug)}
        />
      </header>

      {!project ? (
        <div className="border-border bg-surface flex-1 rounded-xl border">
          <EmptyState title={projects.data?.length ? "Select a project" : "No projects yet"}>
            {projects.data?.length
              ? "The dropdowns above switch project and workspace without leaving this tab."
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
            workspaceId={targetId}
            workspaceSlug={workspaceSlug}
            targetLabel={targetLabel}
            available={capabilities.data?.terminal === true}
            visible={tab === "terminal"}
          />
          {tab === "terminal" ? null : workspaces.isLoading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : workspaces.isError ? (
            <ErrorBanner error={workspaces.error} onRetry={() => workspaces.refetch()} />
          ) : !targetReady ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              <EmptyState title="That workspace is unavailable">
                Workspace {workspaceSlug} is no longer connected.{" "}
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
              workspace={targetId}
              workspaces={workspaces.data ?? []}
              projectLocalPath={project.localPath}
              targetKey={targetKey}
              targetLabel={targetLabel}
              status={status.data}
              loading={status.isLoading}
              error={status.error}
              onSelectWorkspace={(slug) => select(projectId, slug)}
            />
          )}
        </>
      )}
    </div>
  );
}

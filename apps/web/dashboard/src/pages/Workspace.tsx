import { useEffect, useMemo } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { CloudMachineNotice } from "../components/CloudMachineNotice.js";
import { NoRoot } from "../components/NoRoot.js";
import { SourceControl } from "../components/SourceControl.js";
import { EmptyState, ErrorBanner, Skeleton } from "../components/ui.js";
import { WorkspaceRootSelector } from "../components/WorkspaceRootSelector.js";
import { WorkspaceTerminals } from "../components/WorkspaceTerminals.js";
import {
  cloudLocation,
  defaultBranchOf,
  repositoryLabel,
  rootLabel,
  workspaceOptions,
} from "../projectModel.js";
import {
  useGitStatus,
  useMachines,
  useProjects,
  useWorkspaceCapabilities,
  useWorkspaces,
} from "../queries.js";
import {
  canonicalSelector,
  defaultRootIsOpen,
  otherRootLabel,
  parseSelector,
  rootIsOpen,
  workspacesAt,
} from "../selectors.js";
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
  const machines = useMachines();
  const projectId = search.get("project") ?? "";
  const asked = search.get("workspace");
  const workspaces = useWorkspaces(projectId || undefined);
  const tab = search.get("view") === "terminal" ? "terminal" : "source";
  const setTab = (value: "source" | "terminal") => {
    const params = new URLSearchParams(search);
    if (value === "terminal") params.set("view", "terminal");
    else params.delete("view");
    setSearch(params, { replace: true });
  };

  const project = projects.data?.find((item) => item.id === projectId);
  // One selector per working copy: the root of the default location is null
  // however the address names it, so its terminal and its cache are one.
  const workspaceSlug = canonicalSelector(asked, project);
  const parsed = parseSelector(workspaceSlug);
  const selectedWorkspace = parsed.root
    ? undefined
    : workspaces.data?.find((item) => item.slug === parsed.slug);
  // Where the target is, which decides what to say when it does not answer and
  // where a workspace made from here is put.
  const home = parsed.root
    ? project?.locations.find((location) =>
        parsed.location === null ? location.default : location.slug === parsed.location,
      )
    : selectedWorkspace?.cloud
      ? (project && cloudLocation(project)) || undefined
      : selectedWorkspace
        ? project?.locations.find(
            (location) =>
              location.kind === "local" &&
              location.deviceId === (selectedWorkspace.deviceId ?? project.deviceId),
          )
        : undefined;
  const otherRoot = parsed.root && parsed.location !== null;
  // The root of the default location, in a project that has none to ask: it
  // lives nowhere, or Exeora Cloud holds no instance for it.
  const noRoot = parsed.root && !otherRoot && project !== undefined && !defaultRootIsOpen(project);
  const targetReady = parsed.root
    ? otherRoot
      ? home !== undefined && rootIsOpen(home)
      : !noRoot
    : selectedWorkspace !== undefined;
  // What the requests name: a workspace by its id, the root of another
  // location by its selector, and the root of the default one by nothing.
  const targetId = selectedWorkspace?.id ?? (otherRoot ? (workspaceSlug ?? undefined) : undefined);
  const targetKey = targetId ?? "main";
  const ready = Boolean(project) && targetReady;
  // A git status speaks for the machine it ran on, so what is compared with
  // it is that location's root and the workspaces on that machine.
  const siblings = project
    ? workspacesAt(project, home, workspaces.data ?? [], selectedWorkspace)
    : [];
  const rootPath = home?.localPath ?? (home?.default ? (project?.localPath ?? "") : "");
  const capabilities = useWorkspaceCapabilities(projectId, targetId, ready);
  // Every poll runs a status on the machine: only while the list is on screen
  // and the CLI can answer it.
  const status = useGitStatus(
    projectId,
    targetId,
    ready,
    tab === "source" && capabilities.data?.sourceControl !== false,
  );
  // The branch the default location's root is really on, once its machine
  // has said. What another location's status says is about another root, so
  // until then, and from there, it is the one the project was added with.
  const rootBranch =
    (home?.default
      ? ((parsed.root ? status.data?.head : null) ??
        projectRootBranch(status.data?.gitWorkspaces, rootPath, siblings))
      : null) ?? defaultBranchOf(project);
  const targetLabel =
    selectedWorkspace?.slug ??
    (otherRoot
      ? otherRootLabel(home ?? { name: parsed.root ? (parsed.location ?? "") : "" })
      : rootLabel(rootBranch));

  // An address that names the default root the long way is put right, so the
  // terminal chips and the selector agree on what is on screen.
  useEffect(() => {
    if (!project || asked === workspaceSlug) return;
    const params = new URLSearchParams(search);
    if (workspaceSlug) params.set("workspace", workspaceSlug);
    else params.delete("workspace");
    setSearch(params, { replace: true });
  }, [project, asked, workspaceSlug, search, setSearch]);

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
            {project
              ? [
                  home?.name,
                  home?.kind === "cloud"
                    ? repositoryLabel(project.cloud?.repoUrl ?? project.repoUrl)
                    : (selectedWorkspace?.localPath ??
                      home?.localPath ??
                      // The path a project that lives nowhere still carries is
                      // of a machine that is gone.
                      (project.nowhere ? repositoryLabel(project.repoUrl) : project.localPath)),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Choose a project to open its git client."}
          </p>
        </div>
        <WorkspaceRootSelector
          projects={projects.data ?? []}
          projectId={project?.id ?? ""}
          options={
            project
              ? workspaceOptions(project, workspaces.data ?? [], machines.data ?? [], rootBranch)
              : []
          }
          selectedSlug={workspaceSlug}
          onSelectProject={(id) => select(id, null)}
          onSelectWorkspace={(slug) => select(projectId, slug)}
        />
      </header>

      {!project ? (
        <div className="border-border bg-surface flex-1 rounded-xl border">
          <EmptyState title={projects.data?.length ? "Select a project" : "No projects yet"}>
            {projects.data?.length ? (
              "The dropdowns above switch project and workspace without leaving this tab."
            ) : (
              <>
                This is where a project's changes are reviewed and committed.{" "}
                <Link to="/projects?add=1" className="underline">
                  Add project
                </Link>
                .
              </>
            )}
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
            visible={tab === "terminal" && !noRoot}
          />
          {/* Under both tabs: with no root there is no git client to show
              and no machine to open a shell on. */}
          {noRoot ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              <NoRoot project={project} />
            </div>
          ) : tab === "terminal" ? null : workspaces.isLoading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : workspaces.isError ? (
            <ErrorBanner error={workspaces.error} onRetry={() => workspaces.refetch()} />
          ) : !targetReady ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              <EmptyState title="That workspace is unavailable">
                {otherRoot
                  ? home
                    ? home.state === "removed"
                      ? `${home.name} was removed, so its copy of the project cannot be opened.`
                      : `${home.name} holds no copy of the project yet. The first workspace made there clones it.`
                    : `This project does not live on ${parsed.root ? parsed.location : ""}.`
                  : `Workspace ${workspaceSlug} is no longer connected.`}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => select(project.id, null)}
                >
                  Open {rootLabel(defaultBranchOf(project))}
                </button>
                .
              </EmptyState>
            </div>
          ) : capabilities.isError ? (
            <ErrorBanner error={capabilities.error} onRetry={() => capabilities.refetch()} />
          ) : capabilities.data && !capabilities.data.sourceControl ? (
            <div className="border-border bg-surface flex-1 rounded-xl border">
              {home?.kind === "cloud" && !capabilities.data.online ? (
                <CloudMachineNotice projectId={project.id} workspaceId={targetId ?? null} />
              ) : (
                <EmptyState
                  title={
                    capabilities.data.online
                      ? "CLI update required"
                      : `${home?.name ?? "The machine"} is offline`
                  }
                >
                  {capabilities.data.online ? (
                    `Update the Exeora CLI on ${home?.name ?? "the machine"} to enable Source Control.`
                  ) : (
                    <>
                      Run <code className="font-mono">exeora connect</code> on{" "}
                      {home?.name ?? "the machine that holds this workspace"}. This view opens on
                      its own once it is back.
                    </>
                  )}
                </EmptyState>
              )}
            </div>
          ) : (
            <SourceControl
              key={targetKey}
              projectId={projectId}
              workspace={targetId}
              workspaces={siblings}
              root={{
                path: rootPath,
                selector: home?.default === false ? `main@${home.slug}` : null,
              }}
              project={project}
              where={home}
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

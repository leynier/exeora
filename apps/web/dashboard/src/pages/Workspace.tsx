import { Files, GitBranch, GitPullRequest, ScrollText, Search, SquareTerminal } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useWorkspaceLogs } from "../components/logs/useWorkspaceLogs.js";
import { NoRoot } from "../components/NoRoot.js";
import { EmptyState, ErrorBanner, Skeleton } from "../components/ui.js";
import { WorkspaceRootSelector } from "../components/WorkspaceRootSelector.js";
import { bufferStore } from "../components/workspace/bufferStore.js";
import type { WorkspaceContext } from "../components/workspace/context.js";
import { DetailContent, detailHeading } from "../components/workspace/DetailContent.js";
import { scopedKey, targetScopedKey } from "../components/workspace/scope.js";
import { useWorkspaceSurface } from "../components/workspace/surface.js";
import { useAutoRefresh } from "../components/workspace/useAutoRefresh.js";
import { useOpener } from "../components/workspace/useOpener.js";
import { useWorkspaceActions } from "../components/workspace/useWorkspaceActions.js";
import { viewPanel } from "../components/workspace/ViewPanel.js";
import { WorkspaceMain } from "../components/workspace/WorkspaceMain.js";
import { type ShellView, WorkspaceShell } from "../components/workspace/WorkspaceShell.js";
import {
  parseView,
  viewParam,
  type WorkspaceView,
} from "../components/workspace/workspaceLayout.js";
import { useWide } from "../hooks/useBreakpoint.js";
import { useWorkspaceShortcuts } from "../hooks/useWorkspaceShortcuts.js";
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
    const raw = localStorage.getItem(scopedKey(LAST_KEY));
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
  localStorage.setItem(scopedKey(LAST_KEY), JSON.stringify(value));
}

/** What the address asks to see, without the project and working copy it names. */
function pendingIntent(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("project");
  next.delete("workspace");
  return next;
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
  const navigate = useNavigate();
  const wide = useWide();
  const view = parseView(search.get("view"));
  const setView = useCallback(
    (value: WorkspaceView) => {
      const params = new URLSearchParams(search);
      const param = viewParam(value);
      if (param) params.set("view", param);
      else params.delete("view");
      // A detail belongs to the view it was opened from.
      params.delete("detail");
      setSearch(params, { replace: true });
    },
    [search, setSearch],
  );
  useWorkspaceShortcuts({ enabled: wide, onView: setView });

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
  // Every poll runs a status on the machine: only while a list that shows it
  // is on screen and the CLI can answer it. The git client polls on its own,
  // status and open diff together, so this query only fetches for it once.
  const canPoll = ready && capabilities.data?.sourceControl !== false;
  const status = useGitStatus(projectId, targetId, ready, view === "explorer" && canPoll);
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

  // Tabs are kept per project and working copy, and per panel when the
  // Workspace is embedded; a tab with edits still waiting comes back dirty.
  const surface = useWorkspaceSurface();
  const opener = useOpener({
    wide,
    // A detail asked for before a project is chosen waits for one.
    hold: !projectId,
    targetKey: targetScopedKey(projectId, targetKey),
    search,
    setSearch,
    status: status.data,
    isDirty: (path) => bufferStore.get(projectId, targetKey, path) !== undefined,
  });
  const target = useMemo(
    () => ({ projectId, workspace: targetId, targetKey }),
    [projectId, targetId, targetKey],
  );
  const base = useWorkspaceActions(target);
  const refresh = useAutoRefresh({
    target,
    enabled: view === "source" && canPoll,
    selected: opener.selected,
    pending: base.pending,
  });
  // A poll that was in flight when an action started must not land after
  // it, or the list would go back to before the change for a tick.
  const { run: runAction } = base;
  const { interrupt, resume } = refresh;
  const run = useCallback<typeof runAction>(
    async (batch, options) => {
      await interrupt();
      try {
        return await runAction(batch, options);
      } finally {
        resume();
      }
    },
    [interrupt, resume, runAction],
  );
  const actions = { ...base, run };
  const logs = useWorkspaceLogs({
    projectId,
    workspace: targetId,
    targetKey,
    active: view === "logs" && ready,
  });

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
    setSearch(
      (current) => {
        const params = pendingIntent(current);
        params.set("project", restored.projectId);
        if (restored.workspace) params.set("workspace", restored.workspace);
        return params;
      },
      { replace: true },
    );
  }, [restored, setSearch]);

  const select = (nextProject: string, nextWorkspace: string | null) => {
    const go = () => {
      // Without a project yet, what the address asked to see (a file, a diff,
      // a search) is still to come, and opens in the project picked now. A
      // file of another project means nothing here, so a switch keeps the view.
      const params = projectId ? new URLSearchParams() : pendingIntent(search);
      if (nextProject) params.set("project", nextProject);
      if (nextWorkspace) params.set("workspace", nextWorkspace);
      const param = viewParam(view);
      if (param) params.set("view", param);
      setSearch(params, { replace: true });
      if (nextProject) writeLast({ projectId: nextProject, workspace: nextWorkspace });
    };
    // An embedding may ask first when edits are waiting where this leaves.
    if (surface?.changeTarget) {
      surface.changeTarget({ projectId: nextProject || null, workspace: nextWorkspace }, go);
    } else go();
  };

  const report = surface?.report;
  const openPaths = opener.tabs.tabs.flatMap((tab) =>
    tab.detail.kind === "file" || tab.detail.kind === "diff" ? [tab.detail.path] : [],
  );
  const openKey = openPaths.join("\n");
  const active = opener.selected;
  const locationsKey = project
    ? JSON.stringify(project.locations.map(({ slug, default: main }) => ({ slug, default: main })))
    : null;
  useEffect(() => {
    report?.({
      projectId: projectId || null,
      workspace: workspaceSlug ?? null,
      targetKey,
      locations: locationsKey
        ? (JSON.parse(locationsKey) as { slug: string; default: boolean }[])
        : null,
      view,
      openPaths: openKey ? openKey.split("\n") : [],
      active,
    });
  }, [report, projectId, workspaceSlug, targetKey, view, openKey, active, locationsKey]);

  if (projects.isLoading) {
    return <Skeleton className="h-full w-full rounded-xl" />;
  }

  const ctx: WorkspaceContext | null = project
    ? {
        project,
        target,
        targetLabel,
        home,
        siblings,
        root: { path: rootPath, selector: home?.default === false ? `main@${home.slug}` : null },
        rootPath,
        status,
        capabilities: capabilities.data,
        actions,
        logs,
        refresh,
        open: opener.open,
        selected: opener.selected,
        setDirty: opener.setDirty,
        dirtyPaths: opener.dirtyPaths,
        wide,
        onSelectWorkspace: (slug) => select(projectId, slug),
      }
    : null;

  /**
   * What stands in for every view: the project has no root to open, or the
   * workspace asked for is not there. The views stay in the frame so the
   * terminal and the git client say the same thing under the same buttons.
   */
  const blocked: ReactNode | null = !project ? null : noRoot ? (
    <NoRoot project={project} />
  ) : workspaces.isLoading ? (
    <Skeleton className="h-full w-full" />
  ) : workspaces.isError ? (
    <ErrorBanner error={workspaces.error} onRetry={() => workspaces.refetch()} />
  ) : !targetReady ? (
    <EmptyState title="That workspace is unavailable">
      {otherRoot
        ? home
          ? home.state === "removed"
            ? `${home.name} was removed, so its copy of the project cannot be opened.`
            : `${home.name} holds no copy of the project yet. The first workspace made there clones it.`
          : `This project does not live on ${parsed.root ? parsed.location : ""}.`
        : `Workspace ${workspaceSlug} is no longer connected.`}{" "}
      <button type="button" className="underline" onClick={() => select(project.id, null)}>
        Open {rootLabel(defaultBranchOf(project))}
      </button>
      .
    </EmptyState>
  ) : null;

  const shown =
    blocked || !ctx ? { panel: null, layout: "full" as const } : viewPanel(view, ctx, capabilities);
  const views: ShellView[] = [
    { id: "explorer", label: "Explorer", icon: Files },
    { id: "search", label: "Search", icon: Search },
    {
      id: "source",
      label: "Source Control",
      short: "Git",
      icon: GitBranch,
      badge: status.data?.files.length ? status.data.files.length : undefined,
    },
    { id: "pr", label: "Pull Request", short: "PR", icon: GitPullRequest },
    { id: "terminal", label: "Terminal", icon: SquareTerminal },
    { id: "logs", label: "Logs", icon: ScrollText },
  ];

  const back = () => {
    // The detail was pushed, so Back pops it when there is somewhere to pop
    // to; a link opened straight onto a detail has nothing behind it.
    const state = window.history.state as { idx?: number } | null;
    if (state && typeof state.idx === "number" && state.idx > 0) navigate(-1);
    else {
      const params = new URLSearchParams(search);
      params.delete("detail");
      setSearch(params, { replace: true });
    }
  };

  const detail = ctx && !blocked && opener.detail ? opener.detail : null;
  const heading = detail ? detailHeading(detail) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={
          wide
            ? "mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3"
            : "mb-2 flex shrink-0 items-center gap-2"
        }
      >
        {wide ? (
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
        ) : null}
        <WorkspaceRootSelector
          projects={projects.data ?? []}
          projectId={project?.id ?? ""}
          options={
            project
              ? workspaceOptions(project, workspaces.data ?? [], machines.data ?? [], rootBranch)
              : []
          }
          selectedSlug={workspaceSlug}
          compact={!wide}
          onSelectProject={(id) => select(id, null)}
          onSelectWorkspace={(slug) => select(projectId, slug)}
        />
      </header>

      {!project || !ctx ? (
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
          <WorkspaceShell
            views={views}
            view={view}
            onViewChange={setView}
            layout={blocked ? "full" : shown.layout}
            panel={blocked ?? shown.panel}
            main={<WorkspaceMain ctx={ctx} opener={opener} />}
            detail={
              detail && heading
                ? {
                    title: heading.title,
                    subtitle: heading.subtitle,
                    content: <DetailContent ctx={ctx} detail={detail} />,
                  }
                : null
            }
            onBack={back}
          />
          <ConfirmDialog
            open={actions.confirm !== null}
            title={actions.confirm?.title ?? "Confirm action"}
            body={actions.confirm?.body ?? ""}
            confirmLabel={actions.confirm?.label ?? "Confirm"}
            pending={actions.pending}
            onConfirm={() => actions.confirm && void actions.run(actions.confirm.action)}
            onCancel={() => actions.setConfirm(null)}
          />
        </>
      )}
    </div>
  );
}

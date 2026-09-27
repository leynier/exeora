import type { CloudInstance, LocalMachine, Machine, MachineProject } from "./api-projects.js";
import type { Project, ProjectLocation, State, Workspace } from "./api-types.js";

/**
 * How a project, its locations and its workspaces are put together for a page.
 *
 * The gateway answers with three flat lists: projects with their locations,
 * the workspaces of a project, and every machine. The pages show one tree.
 * Building it here, without React, keeps the rules in one place: which
 * location a workspace belongs to, where the project root is shown, and what
 * it is called.
 */

/** The oldest CLI that can clone a project onto a machine that has no copy. */
export const MIN_CLI_FOR_LOCATIONS = "0.18.0";

/** The branch the project root is on, from wherever the gateway learned it. */
export function defaultBranchOf(
  project: Pick<Project, "defaultBranch" | "cloud"> | undefined,
): string | null {
  return project?.defaultBranch ?? project?.cloud?.defaultBranch ?? null;
}

/**
 * What the project root is called: its real branch, marked as the default.
 *
 * Never `main` unless that is the branch. With no branch known, which is a
 * directory that has no repository, the mark alone is the name.
 */
export function rootLabel(branch: string | null | undefined): string {
  return branch ? `${branch} · default` : "default";
}

/** A workspace by its branch. The slug stands in for a detached HEAD. */
export function workspaceLabel(workspace: { branch: string | null; slug: string }): string {
  return workspace.branch ?? workspace.slug;
}

/** What an instance is called: the branch of its workspace, `default` for the root. */
export function instanceLabel(instance: Pick<CloudInstance, "workspace">): string {
  return instance.workspace.id === null
    ? rootLabel(instance.workspace.branch)
    : workspaceLabel(instance.workspace);
}

/**
 * The workspace a tool call ran in, as the activity lists name it. The log
 * keeps the slug, and no slug is the project root.
 */
export function callWorkspaceLabel(
  slug: string | null,
  project: Pick<Project, "defaultBranch" | "cloud"> | undefined,
  workspaces: readonly Pick<Workspace, "slug" | "branch">[] = [],
): string {
  if (slug === null || slug === "main") return rootLabel(defaultBranchOf(project));
  const workspace = workspaces.find((candidate) => candidate.slug === slug);
  return workspace ? workspaceLabel(workspace) : slug;
}

/** Where the Workspace page opens a workspace. No slug is the project root. */
export function workspaceHref(projectId: string, slug: string | null): string {
  const params = new URLSearchParams({ project: projectId });
  if (slug) params.set("workspace", slug);
  return `/workspace?${params}`;
}

/**
 * A git remote as a person reads it: `github.com/owner/name`, with no scheme
 * and no `.git`. An address that is not a URL is shown as it is.
 */
export function repositoryLabel(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(repoUrl);
  const tidy = (path: string) => path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (scp?.[1] && scp[2]) return `${scp[1]}/${tidy(scp[2])}`;
  try {
    const url = new URL(repoUrl);
    return `${url.host}/${tidy(url.pathname)}`;
  } catch {
    return repoUrl;
  }
}

/** A slug the gateway accepts: lowercase letters, digits and hyphens. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The last path segment of a repository address, without `.git`. */
export function nameFromRepoUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return last.replace(/\.git$/, "");
  } catch {
    return "";
  }
}

/** Plain https, nothing in front of the host: a token belongs in its own field. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * Whether a CLI is older than a version. One that never said its version is
 * taken as older: what it cannot be shown to do, it is not asked to do.
 */
export function isOlderCli(version: string | null | undefined, minimum: string): boolean {
  if (!version) return true;
  const parts = (value: string) =>
    (value.replace(/^v/, "").split(/[-+]/)[0] ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const have = parts(version);
  const need = parts(minimum);
  for (let index = 0; index < Math.max(have.length, need.length); index += 1) {
    const left = have[index] ?? 0;
    const right = need[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}

/**
 * Whether a location holds a copy of the project root. A machine does once it
 * has cloned; Exeora Cloud does while it runs an instance for the root.
 */
export function holdsRoot(location: Pick<ProjectLocation, "kind" | "status" | "deviceId">) {
  return location.kind === "cloud" ? location.deviceId !== null : location.status === "ready";
}

/** The Cloud location of a project, when it is there. */
export function cloudLocation(project: Pick<Project, "locations">): ProjectLocation | null {
  return project.locations.find((location) => location.kind === "cloud") ?? null;
}

/** Whether every copy of the project is on Exeora Cloud, so nothing survives its instances. */
export function livesOnlyOnCloud(project: Pick<Project, "locations">): boolean {
  return (
    project.locations.length > 0 && project.locations.every((location) => location.kind === "cloud")
  );
}

export function instancesOf(machines: readonly Machine[], projectId?: string): CloudInstance[] {
  return machines.filter(
    (machine): machine is CloudInstance =>
      machine.kind === "cloud" && (projectId === undefined || machine.project.id === projectId),
  );
}

export function localMachines(machines: readonly Machine[]): LocalMachine[] {
  return machines.filter((machine): machine is LocalMachine => machine.kind === "local");
}

/**
 * How many workspaces a project has, from the list of machines: the ones each
 * of the person's machines holds, and one for every instance that is not the
 * project root.
 */
export function workspaceCount(machines: readonly Machine[], projectId: string): number {
  let count = 0;
  for (const machine of machines) {
    if (machine.kind === "cloud") {
      if (machine.project.id === projectId && machine.workspace.id !== null) count += 1;
      continue;
    }
    count += machine.projects.find((held) => held.projectId === projectId)?.workspaces ?? 0;
  }
  return count;
}

/**
 * Whether a project is on its way out. One that lives only on Exeora Cloud is
 * gone once its instances are, a moment after it was asked for, and is listed
 * as leaving until then.
 */
export function isLeaving(
  project: Pick<Project, "id" | "locations">,
  machines: readonly Machine[],
) {
  const instances = instancesOf(machines, project.id);
  return (
    livesOnlyOnCloud(project) &&
    instances.length > 0 &&
    instances.every((instance) => instance.state === "removing")
  );
}

/** One row under a location: the project root, or a workspace. */
export interface WorkspaceEntry {
  /** Stable across polls: the workspace id, or the location's for the root. */
  key: string;
  root: boolean;
  workspaceId: string | null;
  /** What the Workspace page takes. Null is the project root. */
  slug: string | null;
  branch: string | null;
  /** The name the row shows: the branch, with `default` for the root. */
  label: string;
  /** Where the working copy is on its machine. Null on Exeora Cloud, where nobody needs it. */
  localPath: string | null;
  /** Set on Exeora Cloud, where the workspace is an instance with a state of its own. */
  instance: CloudInstance | null;
  /** Null on a machine, where the workspace is as reachable as the machine is. */
  state: State | null;
  /**
   * Whether the Workspace page can open it. A call that names no workspace
   * lands in the default location, so the root of any other is a copy that
   * nothing reaches until that location is made the default.
   */
  openable: boolean;
}

export interface LocationGroup {
  location: ProjectLocation;
  entries: WorkspaceEntry[];
}

export interface ProjectTree {
  groups: LocationGroup[];
  /** Workspaces on a machine that is no location of the project, which should be none. */
  unplaced: WorkspaceEntry[];
}

/** An instance opens when it is running, or asleep and a call away from running. */
const OPENABLE_INSTANCE = new Set<string>(["online", "asleep"]);

/**
 * Puts the workspaces of a project under the locations they are in.
 *
 * The project root comes first under every location that holds a copy of it,
 * then the workspaces by name. On Exeora Cloud an instance is listed even
 * before its workspace is, so one that is being set up shows from the moment
 * it was asked for.
 */
export function groupByLocation(
  project: Project,
  workspaces: readonly Workspace[],
  machines: readonly Machine[],
): ProjectTree {
  const branch = defaultBranchOf(project);
  const instances = instancesOf(machines, project.id);
  const cloud = cloudLocation(project);
  const groups = new Map<string, WorkspaceEntry[]>(
    project.locations.map((location) => [location.id, []]),
  );
  const unplaced: WorkspaceEntry[] = [];

  for (const workspace of workspaces) {
    const instance = workspace.cloud
      ? (instances.find((candidate) => candidate.workspace.id === workspace.id) ?? null)
      : null;
    const home = workspace.cloud
      ? cloud
      : (project.locations.find(
          (location) =>
            location.kind === "local" &&
            location.deviceId === (workspace.deviceId ?? project.deviceId),
        ) ?? null);
    const entry: WorkspaceEntry = {
      key: workspace.id,
      root: false,
      workspaceId: workspace.id,
      slug: workspace.slug,
      branch: workspace.branch,
      label: workspaceLabel(workspace),
      localPath: workspace.cloud ? null : workspace.localPath,
      instance,
      state: instance?.state ?? null,
      openable: instance ? OPENABLE_INSTANCE.has(instance.state) : true,
    };
    const list = home ? groups.get(home.id) : undefined;
    if (list) list.push(entry);
    else unplaced.push(entry);
  }

  if (cloud) {
    const listed = new Set(workspaces.map((workspace) => workspace.id));
    for (const instance of instances) {
      const id = instance.workspace.id;
      if (id === null || listed.has(id)) continue;
      groups.get(cloud.id)?.push({
        key: id,
        root: false,
        workspaceId: id,
        slug: instance.workspace.slug,
        branch: instance.workspace.branch,
        label: workspaceLabel(instance.workspace),
        localPath: null,
        instance,
        state: instance.state,
        openable: OPENABLE_INSTANCE.has(instance.state),
      });
    }
  }

  return {
    groups: project.locations.map((location) => {
      const entries = [...(groups.get(location.id) ?? [])].sort((left, right) =>
        left.label.localeCompare(right.label),
      );
      if (!holdsRoot(location)) return { location, entries };

      const instance =
        location.kind === "cloud"
          ? (instances.find((candidate) => candidate.workspace.id === null) ?? null)
          : null;
      const root: WorkspaceEntry = {
        key: `root:${location.id}`,
        root: true,
        workspaceId: null,
        slug: null,
        branch: instance?.workspace.branch ?? branch,
        label: rootLabel(instance?.workspace.branch ?? branch),
        localPath: location.localPath,
        instance,
        state: instance?.state ?? (location.kind === "cloud" ? location.state : null),
        openable: location.default && (instance ? OPENABLE_INSTANCE.has(instance.state) : true),
      };
      return { location, entries: [root, ...entries] };
    }),
    unplaced,
  };
}

/**
 * What deleting a machine takes with it.
 *
 * A project goes with the machine when it lives nowhere else that still
 * stands. One with another location keeps going there, and that location
 * becomes its default if this machine was.
 */
export function deletionImpact(
  machine: Pick<LocalMachine, "deviceId" | "projects">,
  projects: readonly Pick<Project, "id" | "locations">[],
): { deleted: MachineProject[]; surviving: MachineProject[] } {
  const deleted: MachineProject[] = [];
  const surviving: MachineProject[] = [];
  for (const held of machine.projects) {
    const project = projects.find((candidate) => candidate.id === held.projectId);
    // Exeora Cloud counts even when it runs no instance for the project
    // root: the gateway starts one and makes Cloud the default before the
    // machine is deleted.
    const elsewhere = (project?.locations ?? []).some(
      (location) =>
        location.state !== "removed" &&
        (location.kind === "cloud" ||
          (location.deviceId !== null && location.deviceId !== machine.deviceId)),
    );
    (elsewhere ? surviving : deleted).push(held);
  }
  return { deleted, surviving };
}

/** A choice in the workspace selector of the Workspace page. */
export interface WorkspaceOption {
  /** The selector the URL takes. `main` is the project root. */
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * The workspaces of a project as the selector lists them: each by its branch
 * and the location it is in, the root marked as the default.
 *
 * The root is listed once, for the default location, because that is the only
 * one a call that names no workspace can reach. An instance that is still
 * being set up is listed with its state and cannot be chosen yet.
 */
export function workspaceOptions(
  project: Project,
  workspaces: readonly Workspace[],
  machines: readonly Machine[],
  rootBranch?: string | null,
): WorkspaceOption[] {
  const tree = groupByLocation(project, workspaces, machines);
  const options: WorkspaceOption[] = [];
  const home = project.locations.find((location) => location.default);
  const root = tree.groups
    .find((group) => group.location.id === home?.id)
    ?.entries.find((entry) => entry.root);

  options.push({
    value: "main",
    label: [rootLabel(rootBranch ?? root?.branch ?? defaultBranchOf(project)), home?.name]
      .filter(Boolean)
      .join(" · "),
    ...(root?.state && !OPENABLE_INSTANCE.has(root.state)
      ? { hint: root.state, disabled: root.state === "setting up" || root.state === "removing" }
      : {}),
  });

  for (const group of tree.groups) {
    for (const entry of group.entries) {
      if (entry.root || entry.slug === null) continue;
      const waiting = entry.state !== null && !OPENABLE_INSTANCE.has(entry.state);
      options.push({
        value: entry.slug,
        label: `${entry.label} · ${group.location.name}`,
        ...(waiting && entry.state
          ? {
              hint: entry.state,
              disabled: entry.state === "setting up" || entry.state === "removing",
            }
          : {}),
      });
    }
  }
  for (const entry of tree.unplaced) {
    if (entry.slug !== null) options.push({ value: entry.slug, label: entry.label });
  }
  return options;
}

import type { Project, ProjectLocation, Workspace } from "./api-types.js";
import { defaultBranchOf, rootLabel, workspaceLabel } from "./projectModel.js";

/**
 * What names a working copy: a workspace's slug, or the project root of a
 * location.
 *
 * `main`, or nothing at all, is the root of the default location. The root of
 * any other location that holds a copy is `main@<location slug>`. A slug
 * cannot contain `@`, so the two cannot be mistaken for each other, and that
 * is the only thing a selector can be assumed to look like: the same string
 * travels in the address of the Workspace page, in the requests that reach the
 * machine, and in the key a terminal is kept under.
 */

export const ROOT_SELECTOR = "main";

export type ParsedSelector =
  | {
      root: true;
      /** The slug of the location, or null for the default one. */
      location: string | null;
    }
  | { root: false; slug: string };

export function parseSelector(selector: string | null | undefined): ParsedSelector {
  const text = selector?.trim() ?? "";
  if (text === "" || text.toLowerCase() === ROOT_SELECTOR) return { root: true, location: null };
  const at = /^main@(.+)$/i.exec(text);
  if (at?.[1]) return { root: true, location: at[1].toLowerCase() };
  return { root: false, slug: text };
}

/**
 * The selector of a location's root, as the Workspace page and the gateway
 * take it. Null for the default location, which needs no selector.
 */
export function rootSelectorOf(location: Pick<ProjectLocation, "slug" | "default">) {
  return location.default ? null : `${ROOT_SELECTOR}@${location.slug}`;
}

/**
 * One selector per working copy. The root of the default location answers to
 * `main`, to nothing and to `main@<its slug>`, and all three become null here,
 * so a terminal opened under one of them is found again under the others.
 */
export function canonicalSelector(
  selector: string | null | undefined,
  project: Pick<Project, "locations"> | undefined,
): string | null {
  const parsed = parseSelector(selector);
  if (!parsed.root) return parsed.slug;
  if (parsed.location === null) return null;
  const location = project?.locations.find((entry) => entry.slug === parsed.location);
  return location?.default ? null : `${ROOT_SELECTOR}@${parsed.location}`;
}

/**
 * Whether a location's root can be opened: it holds a copy, and its machine
 * still stands. The gateway answers 404 for any other.
 */
export function rootIsOpen(
  location: Pick<ProjectLocation, "kind" | "status" | "deviceId" | "state">,
) {
  if (location.state === "removed") return false;
  return location.kind === "cloud" ? location.deviceId !== null : location.status === "ready";
}

/**
 * Whether the root of the default location can be opened. A project that
 * lives nowhere has no default machine to ask, and Exeora Cloud with no
 * instance has nothing running to open until one is made.
 */
export function defaultRootIsOpen(project: Pick<Project, "nowhere" | "locations">): boolean {
  if (project.nowhere === true) return false;
  return project.locations.find((location) => location.default)?.state !== "no instance";
}

/** What the root of a location that is not the default is called, until its branch is known. */
export function otherRootLabel(location: Pick<ProjectLocation, "name">): string {
  return `root · ${location.name}`;
}

/**
 * The workspaces that share a machine with a location's root, which are the
 * only ones its git status can be talking about. Paths are compared as
 * strings, and the same path on two machines is two different folders.
 *
 * On Exeora Cloud every workspace is a machine of its own, so nothing shares
 * one with the root, and a workspace shares one only with itself.
 */
export function workspacesAt(
  project: Pick<Project, "deviceId">,
  location: Pick<ProjectLocation, "kind" | "deviceId"> | undefined,
  workspaces: readonly Workspace[],
  viewing?: Workspace,
): Workspace[] {
  if (!location) return [];
  if (location.kind === "cloud") return viewing ? [viewing] : [];
  return workspaces.filter(
    (workspace) =>
      !workspace.cloud && (workspace.deviceId ?? project.deviceId) === location.deviceId,
  );
}

/** Where a tool call ran: what it ran in, and the location or machine that holds it. */
export interface CallPlace {
  /** The branch, with the mark for the root. The slug when nothing better is known. */
  label: string;
  /** Null for a call recorded before locations were, and for a workspace that is gone. */
  where: string | null;
}

/**
 * Reads what the activity log kept about where a call ran.
 *
 * The log keeps a selector. For a root it names the location, which is looked
 * up by slug and shown by name; a location that is gone is shown by the slug
 * it had. For a workspace it is the slug, and the machine comes from the
 * workspace itself. An older row says less, and is shown as it always was.
 */
export function callPlace(
  slug: string | null,
  project: Pick<Project, "defaultBranch" | "cloud" | "locations"> | undefined,
  workspaces: readonly Pick<Workspace, "slug" | "branch" | "machine" | "cloud">[] = [],
): CallPlace {
  const parsed = parseSelector(slug);
  if (parsed.root) {
    const label = rootLabel(defaultBranchOf(project));
    if (parsed.location === null) return { label, where: null };
    const location = project?.locations.find((entry) => entry.slug === parsed.location);
    return { label, where: location?.name ?? parsed.location };
  }
  const workspace = workspaces.find((candidate) => candidate.slug === parsed.slug);
  if (!workspace) return { label: parsed.slug, where: null };
  return {
    label: workspaceLabel(workspace),
    where: workspace.cloud ? "Exeora Cloud" : workspace.machine,
  };
}

/** The same, on the one line an activity row has for it. */
export function callPlaceLabel(...input: Parameters<typeof callPlace>): string {
  const place = callPlace(...input);
  return place.where ? `${place.label} · ${place.where}` : place.label;
}

/** Whether a call's place cannot be said without the workspaces of its project. */
export function needsWorkspaces(slug: string | null): boolean {
  return !parseSelector(slug).root;
}

/**
 * The projects whose workspaces a list of calls needs: the ones that still
 * exist and have a call that ran in a workspace. A call in a root says where
 * it ran by itself, and a project that is gone has nothing left to ask.
 */
export function projectsToAsk(
  calls: readonly { projectId: string; workspaceSlug: string | null }[],
  projects: readonly { id: string }[],
): string[] {
  const wanted = new Set(
    calls.filter((call) => needsWorkspaces(call.workspaceSlug)).map((call) => call.projectId),
  );
  return projects.map((project) => project.id).filter((id) => wanted.has(id));
}

import { encodeDetail, type WorkspaceView } from "../components/workspace/workspaceLayout.js";
import { type DiffStyle, workspacePrefs } from "../components/workspace/workspacePrefs.js";

/**
 * What the gateway's panel tools answer with, read defensively: the result
 * crosses the host, and an older gateway may leave fields out.
 *
 * `exeora_open_panel` and `exeora_resolve_file` both name a place in a
 * workspace. `exeora_open_file` answers `needsResolve` when the host kept the
 * file's path to itself, and the panel asks again with a call the host amends.
 */

export interface PanelSettings {
  /** Where the panel opens when the call that opened it named no project. */
  defaultProject: string | null;
  defaultWorkspace: string | null;
  view: WorkspaceView | null;
  showIgnored: boolean | null;
  diffStyle: DiffStyle | null;
}

export interface PanelSelection {
  projectId: string | null;
  workspace: string | null;
  /** Relative to the working copy, with forward slashes. */
  path: string | null;
  settings: PanelSettings;
  /** Where the full dashboard lives, for links out of the panel. */
  gatewayOrigin: string | null;
}

export type PanelAnswer =
  | { kind: "selection"; selection: PanelSelection }
  | { kind: "resolve" }
  | { kind: "failed"; reason: "outside" | "offline" | "not_found" | "error"; message: string };

const FAILURE_REASONS = new Set(["outside", "offline", "not_found"]);

export function readAnswer(structured: unknown): PanelAnswer | null {
  if (!isRecord(structured)) return null;
  if (structured.needsResolve === true) return { kind: "resolve" };
  if (typeof structured.error === "string") {
    const reason = FAILURE_REASONS.has(structured.error)
      ? (structured.error as "outside" | "offline" | "not_found")
      : "error";
    const message = typeof structured.message === "string" ? structured.message : "";
    return { kind: "failed", reason, message: message || failureText(reason) };
  }
  if (!("projectId" in structured) && !("settings" in structured)) return null;
  const settings = readSettings(structured.settings);
  // The gateway answers `projectId: null` on purpose when the saved default
  // is gone (revoked, renamed), while the settings still name it for editing:
  // that null means the picker. Only a result without the field at all, from
  // an older gateway, falls back to the default the settings name.
  const named = "projectId" in structured;
  const projectId = named ? text(structured.projectId) : settings.defaultProject;
  const workspace = named ? text(structured.workspace) : settings.defaultWorkspace;
  return {
    kind: "selection",
    selection: {
      projectId,
      workspace: projectId ? workspace : null,
      path: named && projectId ? relativePath(structured.path) : null,
      settings,
      gatewayOrigin: httpOrigin(structured.gatewayOrigin),
    },
  };
}

export function failureText(reason: "outside" | "offline" | "not_found" | "error"): string {
  switch (reason) {
    case "outside":
      return "This file is not inside any of your Exeora projects.";
    case "offline":
      return "The machine with this file is offline. Run `exeora connect` on it and try again.";
    case "not_found":
      return "Exeora could not find this file in your projects.";
    case "error":
      return "Exeora could not open the workspace.";
  }
}

/** The settings tab's name for a view, as the gateway's structured settings spell it. */
const VIEWS: Record<string, WorkspaceView> = {
  files: "explorer",
  explorer: "explorer",
  "source-control": "source",
  source: "source",
  search: "search",
};

function readSettings(value: unknown): PanelSettings {
  const none = { defaultProject: null, defaultWorkspace: null };
  if (!isRecord(value)) return { ...none, view: null, showIgnored: null, diffStyle: null };
  const tab = value.defaultTab;
  const ignored = value.showIgnored;
  const defaultProject = text(value.defaultProject);
  return {
    defaultProject,
    defaultWorkspace: defaultProject ? text(value.defaultWorkspace) : null,
    view: typeof tab === "string" ? (VIEWS[tab] ?? null) : null,
    showIgnored: typeof ignored === "boolean" ? ignored : null,
    diffStyle:
      value.diffStyle === "split" || value.diffStyle === "unified" ? value.diffStyle : null,
  };
}

/**
 * Hands the settings to the Workspace through the preferences it already
 * reads, so the screen itself needs no idea that it is in ChatGPT.
 */
export function applySettings(settings: PanelSettings): void {
  if (settings.showIgnored !== null) workspacePrefs.showIgnored.write(settings.showIgnored);
  if (settings.diffStyle !== null) workspacePrefs.diffStyle.write(settings.diffStyle);
}

/** The Workspace route that shows a selection: its file when it names one. */
export function selectionRoute(selection: PanelSelection): string {
  const params = new URLSearchParams();
  if (selection.projectId) params.set("project", selection.projectId);
  if (selection.workspace) params.set("workspace", selection.workspace);
  if (selection.path) {
    params.set("view", "explorer");
    params.set("detail", encodeDetail({ kind: "file", path: selection.path }));
  } else if (selection.settings.view) {
    params.set("view", selection.settings.view);
  }
  const query = params.toString();
  return query ? `/workspace?${query}` : "/workspace";
}

/**
 * The route a ChatGPT deep link names (`hostContext["openai/deepLink"].url`),
 * when it is one of the Workspace's own. Anything else stays where it is.
 */
export function deepLinkRoute(value: unknown): string | null {
  const url = isRecord(value) ? value.url : null;
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "https://panel.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://panel.invalid" || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "/workspace") return null;
  return `/workspace${parsed.search}`;
}

/**
 * The gateway the panel belongs to: the origin the tool result names, or the
 * one the `<base>` the gateway put in the resource names. Terminal and log
 * tickets are bound to it, so it is never taken from a ticket response, and
 * a page with no such base (an opaque sandbox) has none.
 */
export function gatewayOrigin(
  selection: Pick<PanelSelection, "gatewayOrigin"> | null,
  baseURI: string = document.baseURI,
): string | null {
  return selection?.gatewayOrigin ?? httpOrigin(baseURI);
}

/** A dashboard path as an address on the gateway, refused when it would leave the dashboard. */
export function dashboardUrl(origin: string, path: string): string | null {
  if (!path.startsWith("/")) return null;
  try {
    const url = new URL(`/dashboard${path}`, origin);
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith("/dashboard/")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function relativePath(value: unknown): string | null {
  const path = text(value);
  if (!path) return null;
  const clean = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) return null;
  return clean;
}

function httpOrigin(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

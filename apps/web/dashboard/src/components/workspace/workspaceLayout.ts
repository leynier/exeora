/**
 * What the Workspace screen shows, written down as data: which view is open,
 * what detail a narrow screen has pushed over it, and which files and diffs
 * a wide screen has open as tabs.
 *
 * The view and the detail live in the address, so Back works in a browser
 * tab and in the side panel alike. The open tabs are the wide layout's own
 * and survive a reload through session storage, per workspace.
 */

export const WORKSPACE_VIEWS = ["explorer", "search", "source", "pr", "terminal", "logs"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export const DEFAULT_VIEW: WorkspaceView = "source";

export function parseView(raw: string | null): WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as WorkspaceView)
    : DEFAULT_VIEW;
}

/** The value of `?view=`, or null when the default needs no mention. */
export function viewParam(view: WorkspaceView): string | null {
  return view === DEFAULT_VIEW ? null : view;
}

export type DiffArea = "working" | "staged";

export type Detail =
  | { kind: "file"; path: string }
  | { kind: "diff"; area: DiffArea; path: string }
  | { kind: "diffall"; area: DiffArea }
  | { kind: "commit"; oid: string }
  | { kind: "commitdiff"; oid: string }
  | { kind: "commitfile"; oid: string; path: string }
  | { kind: "range"; base: string };

/** One string per detail, path last because a path can hold anything. */
export function encodeDetail(detail: Detail): string {
  switch (detail.kind) {
    case "file":
      return `file:${detail.path}`;
    case "diff":
      return `diff:${detail.area}:${detail.path}`;
    case "diffall":
      return `diffall:${detail.area}`;
    case "commit":
      return `commit:${detail.oid}`;
    case "commitdiff":
      return `commitdiff:${detail.oid}`;
    case "commitfile":
      return `commitfile:${detail.oid}:${detail.path}`;
    case "range":
      return `range:${detail.base}`;
  }
}

export function parseDetail(raw: string | null): Detail | null {
  if (!raw) return null;
  const [kind, ...rest] = raw.split(":");
  const joined = rest.join(":");
  switch (kind) {
    case "file":
      return joined ? { kind, path: joined } : null;
    case "diff": {
      const [area, ...path] = rest;
      const target = path.join(":");
      return isArea(area) && target ? { kind, area, path: target } : null;
    }
    case "diffall":
      return isArea(joined) ? { kind, area: joined } : null;
    case "commit":
    case "commitdiff":
      return isOid(joined) ? { kind, oid: joined } : null;
    case "commitfile": {
      const [oid, ...path] = rest;
      const target = path.join(":");
      return oid && isOid(oid) && target ? { kind, oid, path: target } : null;
    }
    case "range":
      return joined ? { kind, base: joined } : null;
    default:
      return null;
  }
}

function isArea(value: string | undefined): value is DiffArea {
  return value === "working" || value === "staged";
}

function isOid(value: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(value);
}

/** What a detail is called in a tab or a detail screen's header. */
export function detailTitle(detail: Detail): string {
  switch (detail.kind) {
    case "file":
    case "diff":
    case "commitfile":
      return detail.path.slice(detail.path.lastIndexOf("/") + 1);
    case "diffall":
      return detail.area === "staged" ? "Staged changes" : "All changes";
    case "commit":
    case "commitdiff":
      return detail.oid.slice(0, 7);
    case "range":
      return `Changes against ${detail.base}`;
  }
}

export type OpenTab = {
  id: string;
  detail: Detail;
  /** A preview is replaced by the next single click; a pinned tab stays. */
  pinned: boolean;
  /** Unsaved edits, for a file tab. */
  dirty: boolean;
};

export type OpenTabs = { tabs: OpenTab[]; active: string | null };

export const NO_TABS: OpenTabs = { tabs: [], active: null };

/**
 * Opens a detail: an existing tab is brought forward (and pinned when asked),
 * a preview tab is replaced unless it has unsaved edits, otherwise a new one
 * is added after the active tab.
 */
export function openTab(state: OpenTabs, detail: Detail, pin = false): OpenTabs {
  const id = encodeDetail(detail);
  const existing = state.tabs.find((tab) => tab.id === id);
  if (existing) {
    // The same state back when it is already open and in front: an effect
    // that opens what the address names must not open it on every render.
    if (state.active === id && (existing.pinned || !pin)) return state;
    const tabs =
      pin && !existing.pinned
        ? state.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: true } : tab))
        : state.tabs;
    return { tabs, active: id };
  }
  const next: OpenTab = { id, detail, pinned: pin, dirty: false };
  const preview = state.tabs.findIndex((tab) => !tab.pinned && !tab.dirty);
  if (!pin && preview >= 0) {
    const tabs = state.tabs.slice();
    tabs[preview] = next;
    return { tabs, active: id };
  }
  const at = state.tabs.findIndex((tab) => tab.id === state.active);
  const tabs = state.tabs.slice();
  tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, next);
  return { tabs, active: id };
}

export function pinTab(state: OpenTabs, id: string): OpenTabs {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: true } : tab)),
  };
}

export function setTabDirty(state: OpenTabs, id: string, dirty: boolean): OpenTabs {
  const tab = state.tabs.find((item) => item.id === id);
  // The same state back when nothing changes, so an effect that reports
  // dirtiness on every render does not start a render on every report.
  if (!tab || (tab.dirty === dirty && (tab.pinned || !dirty))) return state;
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.id === id ? { ...item, dirty, pinned: item.pinned || dirty } : item,
    ),
  };
}

/** Closes a tab; the neighbour that took its place becomes active. */
export function closeTab(state: OpenTabs, id: string): OpenTabs {
  const at = state.tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.active !== id) return { tabs, active: state.active };
  const neighbour = tabs[Math.min(at, tabs.length - 1)];
  return { tabs, active: neighbour?.id ?? null };
}

/** Drops tabs whose detail no longer exists, such as a diff of a file that is clean now. */
export function keepTabs(state: OpenTabs, keep: (tab: OpenTab) => boolean): OpenTabs {
  const tabs = state.tabs.filter((tab) => tab.dirty || keep(tab));
  if (tabs.length === state.tabs.length) return state;
  const active = tabs.some((tab) => tab.id === state.active)
    ? state.active
    : (tabs.at(-1)?.id ?? null);
  return { tabs, active };
}

const TABS_KEY = "exeora.workspace_tabs";

export function readTabs(store: Pick<Storage, "getItem">, targetKey: string): OpenTabs {
  try {
    const raw = store.getItem(`${TABS_KEY}.${targetKey}`);
    if (!raw) return NO_TABS;
    const parsed = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(parsed.tabs)) return NO_TABS;
    const tabs: OpenTab[] = [];
    for (const item of parsed.tabs as { id?: unknown; pinned?: unknown }[]) {
      const detail = typeof item.id === "string" ? parseDetail(item.id) : null;
      if (!detail) continue;
      tabs.push({ id: encodeDetail(detail), detail, pinned: item.pinned === true, dirty: false });
    }
    const active =
      typeof parsed.active === "string" && tabs.some((tab) => tab.id === parsed.active)
        ? parsed.active
        : (tabs[0]?.id ?? null);
    return { tabs, active };
  } catch {
    return NO_TABS;
  }
}

export function writeTabs(store: Pick<Storage, "setItem">, targetKey: string, state: OpenTabs) {
  try {
    store.setItem(
      `${TABS_KEY}.${targetKey}`,
      JSON.stringify({
        tabs: state.tabs.map((tab) => ({ id: tab.id, pinned: tab.pinned })),
        active: state.active,
      }),
    );
  } catch {
    // Storage that refuses is storage the tabs do not outlive this page in.
  }
}

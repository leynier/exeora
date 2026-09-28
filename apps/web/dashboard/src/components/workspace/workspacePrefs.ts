/**
 * What somebody set about the Workspace screen and expects to find again:
 * the side panel's width, tree or flat lists, one diff column or two, and
 * whether ignored files show. Per origin, in local storage, each with a
 * parser so a value somebody else wrote there cannot break the page.
 */

const PREFIX = "exeora.workspace.";

export const DEFAULT_PANEL_WIDTH = 320;
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 480;

export type DiffStyle = "unified" | "split";

export function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PANEL_WIDTH;
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(value)));
}

function read<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // A preference that cannot be stored is still used this session.
  }
}

export const workspacePrefs = {
  panelWidth: {
    read: () => read("panel_width", (raw) => clampPanelWidth(Number(raw)), DEFAULT_PANEL_WIDTH),
    write: (value: number) => {
      const next = clampPanelWidth(value);
      write("panel_width", String(next));
      return next;
    },
  },
  changesTree: flag("changes_tree", false),
  historyOpen: flag("history_open", false),
  showIgnored: flag("show_ignored", false),
  searchTree: flag("search_tree", false),
  diffStyle: {
    read: (): DiffStyle =>
      read("diff_style", (raw) => (raw === "split" ? "split" : "unified"), "unified"),
    write: (value: DiffStyle) => {
      write("diff_style", value);
      return value;
    },
  },
  /** The folders open in the Explorer, per project. */
  expanded: {
    read: (projectId: string): string[] =>
      read(
        `expanded.${projectId}`,
        (raw) => {
          const parsed: unknown = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : null;
        },
        [],
      ),
    write: (projectId: string, paths: readonly string[]) => {
      write(`expanded.${projectId}`, JSON.stringify(paths.slice(0, 500)));
    },
  },
};

function flag(key: string, fallback: boolean) {
  return {
    read: () => read(key, (raw) => raw === "1", fallback),
    write: (value: boolean) => {
      write(key, value ? "1" : "0");
      return value;
    },
  };
}

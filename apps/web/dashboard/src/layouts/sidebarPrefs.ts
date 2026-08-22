/**
 * Collapse and expanded width, remembered on this origin.
 *
 * The rail is 15rem when we have never asked; dragging writes pixels. Collapse
 * is a flag of its own so a width you chose is still there after the icons
 * come back.
 */

export const COLLAPSED_KEY = "exeora.sidebar_collapsed";
export const WIDTH_KEY = "exeora.sidebar_width";

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 440;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

export function parseSidebarWidth(raw: string | null): number {
  if (raw == null || raw === "") return DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(Number(raw));
}

export function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistCollapsed(collapsed: boolean): boolean {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode, or a full quota: the preference just does not survive a reload.
  }
  return collapsed;
}

export function readSidebarWidth(): number {
  try {
    return parseSidebarWidth(localStorage.getItem(WIDTH_KEY));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function persistSidebarWidth(width: number): number {
  const next = clampSidebarWidth(width);
  try {
    localStorage.setItem(WIDTH_KEY, String(next));
  } catch {
    // Same as collapse: a preference that cannot be stored is still used this session.
  }
  return next;
}

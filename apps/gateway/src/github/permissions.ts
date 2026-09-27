import type { GitHubPermissions } from "./app.js";

/**
 * What the Exeora App asks of an account that installs it, and what one
 * installation has said yes to so far.
 *
 * The two differ whenever the app starts asking for more. GitHub does not
 * grant the addition by itself: it asks the owner of each installation, and
 * until they accept, that installation holds what it held before. Nothing
 * that worked stops working, and the dashboard says what is waiting.
 */

/**
 * Everything the app asks for, at the level it asks. The one list: the table
 * in `docs/self-hosting.md` is written from it, and what is pending for an
 * installation is counted against it.
 *
 * The names are the ones GitHub uses in an installation's `permissions` and
 * in the body of a request for a token, which are the same.
 */
export const APP_PERMISSIONS = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
  issues: "write",
  actions: "read",
  checks: "read",
  statuses: "read",
  workflows: "write",
} as const satisfies GitHubPermissions;

export type AppPermission = keyof typeof APP_PERMISSIONS;

/** Each level holds the ones before it. `admin` is never asked for, and may have been given. */
const LEVELS = ["read", "write", "admin"];

/** More names than GitHub has permissions, so a delivery cannot fill a row with them. */
const MAX_STORED = 100;

/**
 * An installation's permissions in the form they are stored, or null for
 * something that is not a list of them. Only what reads as a permission is
 * kept: the rest of what GitHub sends is not ours to repeat.
 */
export function storedPermissions(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const kept: Record<string, string> = {};
  for (const [name, level] of Object.entries(value).slice(0, MAX_STORED)) {
    if (!/^[a-z_]{1,64}$/.test(name)) continue;
    if (typeof level === "string" && LEVELS.includes(level)) kept[name] = level;
  }
  return JSON.stringify(kept);
}

/**
 * The permissions the app asks for that an installation has not granted at
 * the level asked, in the order of `APP_PERMISSIONS`.
 *
 * Empty for an installation GitHub has not described yet. Not knowing is not
 * the same as waiting, and a notice that cannot be acted on is worse than none.
 */
export function pendingPermissions(stored: string | null | undefined): AppPermission[] {
  const granted = parsed(stored);
  if (!granted) return [];
  return (Object.keys(APP_PERMISSIONS) as AppPermission[]).filter((name) => {
    const held = LEVELS.indexOf(String(granted[name] ?? ""));
    return held < LEVELS.indexOf(APP_PERMISSIONS[name]);
  });
}

function parsed(stored: string | null | undefined): Record<string, unknown> | null {
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

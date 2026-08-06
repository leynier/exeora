/** Display helpers. `relativeTime` and `isOnline` live in api.ts, next to the shapes they read. */

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function formatDate(timestamp: number | null): string {
  return timestamp === null ? "unknown" : DATE.format(timestamp);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** The last path segment, which is what identifies a project at a glance. */
export function shortenPath(path: string, keep = 2): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= keep ? path : `…/${parts.slice(-keep).join("/")}`;
}

import type { Client } from "./api.js";

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

/**
 * What to call an AI client.
 *
 * The registered application name first, because that is the one a person
 * recognises: "Claude", not "claude-code". The MCP name is the fallback for a
 * client that registered anonymously, and the raw id is never shown, since it
 * identifies nothing to a reader.
 */
export function clientLabel(client: Pick<Client, "clientName" | "mcpName">): string {
  return client.clientName ?? client.mcpName ?? "Unnamed client";
}

/** The version, when the client announced one over MCP. */
export function clientVersion(client: Pick<Client, "mcpName" | "mcpVersion">): string | null {
  if (!client.mcpVersion) return null;
  return client.mcpName ? `${client.mcpName} ${client.mcpVersion}` : client.mcpVersion;
}

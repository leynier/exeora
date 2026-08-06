import { storedToken } from "./auth.js";

export interface Device {
  id: string;
  name: string;
  platform: string;
  cliVersion: string | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

/**
 * What an agent may do in a project.
 *
 * Mirrors `CommandPolicy` from `@exeora/protocol`. Restated here rather than
 * imported because the dashboard is a browser bundle and that package pulls in
 * zod, which is 40 kB it would carry for one type.
 */
export interface CommandPolicy {
  mode: "allow_all" | "allow_list" | "read_only";
  allow: string[];
  shell: boolean;
  approve: boolean;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  deviceId: string;
  localPath: string;
  mcpUrl: string;
  policy: CommandPolicy;
  createdAt: number;
}

export interface ToolCall {
  id: string;
  projectId: string;
  tool: string;
  status: "ok" | "error";
  durationMs: number;
  errorCode: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: number;
}

/**
 * An AI client authorized against one project.
 *
 * Two names, because neither is always there. `clientName` is what the
 * application registered with the authorization server; `mcpName` is what the
 * software calls itself over MCP, and only that one carries a version.
 */
export interface Client {
  id: string;
  projectId: string;
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  mcpName: string | null;
  mcpVersion: string | null;
  authorizedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export class Unauthorized extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  if (!token) throw new Unauthorized("Not signed in.");

  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  // The token expired or was revoked while the tab was open; the caller sends
  // the user back through sign-in rather than showing a broken page.
  if (response.status === 401) throw new Unauthorized("Session expired.");
  if (!response.ok) throw new Error(`${path} failed (${response.status}).`);

  return (await response.json()) as T;
}

/**
 * How the activity log is narrowed. Every field is optional and applied by the
 * server, so a filter searches the whole log rather than the page in hand.
 */
export interface ToolCallFilters {
  projectId?: string;
  status?: "ok" | "error";
  clientId?: string;
}

/** One page of the audit log. `cursor` is null on the last one. */
export interface ToolCallPage {
  items: ToolCall[];
  cursor: string | null;
}

export const api = {
  me: () => request<User>("/api/me"),
  devices: () => request<Device[]>("/api/devices"),
  projects: () => request<Project[]>("/api/projects"),

  toolCalls: (filters: ToolCallFilters = {}, cursor?: string) => {
    const query = new URLSearchParams();
    if (filters.projectId) query.set("projectId", filters.projectId);
    if (filters.status) query.set("status", filters.status);
    if (filters.clientId) query.set("clientId", filters.clientId);
    if (cursor) query.set("cursor", cursor);

    const suffix = query.size > 0 ? `?${query}` : "";
    return request<ToolCallPage>(`/api/tool-calls${suffix}`);
  },

  revokeDevice: (id: string) => request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),

  /** Only accepted once the machine is revoked; the server returns 409 if not. */
  deleteDevice: (id: string) =>
    request<{ ok: true }>(`/api/devices/${id}/permanently`, { method: "DELETE" }),
  removeProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),

  /** Takes effect on the very next tool call; nothing has to reconnect. */
  setProjectPolicy: (id: string, policy: CommandPolicy) =>
    request<CommandPolicy>(`/api/projects/${id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    }),

  /** Irreversible, and takes every machine, project, client and audit row. */
  deleteAccount: () => request<{ ok: true }>("/api/me", { method: "DELETE" }),

  clients: () => request<Client[]>("/api/clients"),
  revokeClient: (id: string) => request<{ ok: true }>(`/api/clients/${id}`, { method: "DELETE" }),

  /** Only accepted once the client is revoked; the server returns 409 if not. */
  deleteClient: (id: string) =>
    request<{ ok: true }>(`/api/clients/${id}/permanently`, { method: "DELETE" }),
};

/** A device is online if it checked in within the heartbeat timeout. */
export function isOnline(device: Device): boolean {
  return (
    device.revokedAt === null &&
    device.lastSeenAt !== null &&
    Date.now() - device.lastSeenAt < 90_000
  );
}

export function relativeTime(timestamp: number | null): string {
  if (timestamp === null) return "never";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

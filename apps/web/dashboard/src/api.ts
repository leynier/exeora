import { storedToken } from "./auth.js";

export interface Device {
  id: string;
  name: string;
  platform: string;
  cliVersion: string | null;
  online: boolean;
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
  deny: string[];
  shell: boolean;
  approve: boolean;
  /** Null is every tool, which is not the same as naming them all. */
  tools: ToolName[] | null;
}

/**
 * The tools, restated for the same reason `CommandPolicy` is.
 *
 * Ordered as the policy screen reads them: what only looks, then what changes
 * something, which is the order someone deciding what to permit thinks in.
 *
 * **Adding a tool to `@exeora/protocol` means adding it here too.** A tool
 * missing from this list is one the policy screen cannot offer, so a project
 * restricting its tools would have no way to permit it. The failure is visible
 * rather than dangerous, which is the only reason a second list is tolerable.
 */
export const TOOL_NAMES = [
  "read_file",
  "list_files",
  "grep",
  "edit_file",
  "write_file",
  "run_command",
  "start_command",
  "get_command_output",
  "send_command_input",
  "kill_command",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

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

export interface Worktree {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  branch: string | null;
  localPath: string;
  managed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  id: string;
  projectId: string;
  worktreeId: string | null;
  worktreeSlug: string | null;
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
  /**
   * Which URL this access was granted through. Two rows can name the same
   * client and the same project and mean different consents, so the view has to
   * say which one it is showing.
   */
  endpoint: "project" | "account";
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  mcpName: string | null;
  mcpVersion: string | null;
  authorizedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Caps that come with the account's plan. Null means no cap. */
export interface PlanLimits {
  maxDevices: number | null;
  maxProjects: number | null;
  retentionDays: number;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** Which plan this account is on. There is no self-serve upgrade yet. */
  plan: "free" | "pro";
  /** True when this account's email is on the fixed admin allow-list. */
  isAdmin: boolean;
  /** The one MCP URL that covers every project a client is given. */
  accountMcpUrl: string;
  limits: PlanLimits;
  usage: {
    devices: number;
    projects: number;
    toolCallsMonth: number;
  };
}

/** Global totals for the administration overview. */
export interface AdminOverview {
  users: number;
  devices: number;
  devicesOnline: number;
  projects: number;
  clients: number;
  toolCalls: number;
  toolCalls24h: number;
  toolCalls7d: number;
  /** 0–1 fraction of tool calls in the last 7 days that failed. */
  errorRate7d: number;
  usageWindow: "rolling" | "complete_utc_days";
}

/** One row of the admin user list. */
export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
  devices: number;
  devicesOnline: number;
  projects: number;
  clients: number;
  toolCalls: number;
  lastActivityAt: number | null;
}

/** Full admin view of one account. */
export interface AdminUserDetail extends AdminUserSummary {
  machineList: Device[];
  projectList: Array<{
    id: string;
    name: string;
    slug: string;
    deviceId: string;
    localPath: string;
    createdAt: number;
  }>;
  clientList: Client[];
  recentCalls: ToolCall[];
}

/** One project an account-endpoint client was given, as that view lists it. */
export interface AccountClientProject {
  /** The `project_clients` row, which is what revoking acts on. */
  id: string;
  projectId: string;
  revokedAt: number | null;
}

/**
 * A client connected through the account URL.
 *
 * One entry per client rather than per project, because that is what it is: one
 * connection that reaches several projects. Each call names its project when
 * the connection reaches more than one.
 */
export interface AccountClient {
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  mcpName: string | null;
  mcpVersion: string | null;
  authorizedAt: number;
  lastUsedAt: number | null;
  projects: AccountClientProject[];
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
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .then((value) => value as Record<string, unknown>)
      .catch(() => null);
    throw new Error(`${apiError(body)} (${response.status}).`);
  }

  return (await response.json()) as T;
}

function apiError(body: Record<string, unknown> | null): string {
  if (typeof body?.message === "string") return body.message;
  const code = typeof body?.error === "string" ? body.error : null;
  if (code === "plan_limit") {
    const limit = typeof body?.limit === "string" ? body.limit : "resources";
    const max = typeof body?.max === "number" ? ` (${body.max} maximum)` : "";
    return `This plan has reached its ${limit} limit${max}`;
  }
  const messages: Record<string, string> = {
    device_revoked: "That machine has been revoked",
    not_found: "That item no longer exists",
    not_revoked: "Revoke this item before deleting it permanently",
    forbidden: "This account is not allowed to do that",
  };
  return (code && messages[code]) ?? "The gateway could not complete the request";
}

/**
 * How the activity log is narrowed. Every field is optional and applied by the
 * server, so a filter searches the whole log rather than the page in hand.
 */
export interface ToolCallFilters {
  projectId?: string;
  worktreeId?: string;
  status?: "ok" | "error";
  clientId?: string;
}

/** One page of the audit log. `cursor` is null on the last one. */
export interface ToolCallPage {
  items: ToolCall[];
  cursor: string | null;
}

/**
 * A call waiting on someone to confirm it.
 *
 * Lives for ninety seconds inside the relay rather than in a table: there is an
 * AI client holding a request open at the other end of it, so it is either
 * answered now or not at all.
 */
export interface Approval {
  id: string;
  deviceId: string;
  deviceName: string;
  projectId: string;
  worktreeId?: string;
  worktreeSlug?: string;
  tool: string;
  /** Already written for a person: "Run `npm test`?" */
  prompt: string;
  clientName?: string;
  requestedAt: number;
  expiresAt: number;
}

/** Thrown when the terminal answered first. Not an error worth a red banner. */
export class AlreadyAnswered extends Error {}

export const api = {
  me: () => request<User>("/api/me"),
  devices: () => request<Device[]>("/api/devices"),
  projects: () => request<Project[]>("/api/projects"),
  worktrees: (projectId: string) => request<Worktree[]>(`/api/projects/${projectId}/worktrees`),

  toolCalls: (filters: ToolCallFilters = {}, cursor?: string) => {
    const query = new URLSearchParams();
    if (filters.projectId) query.set("projectId", filters.projectId);
    if (filters.worktreeId) query.set("worktreeId", filters.worktreeId);
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

  approvals: () => request<{ items: Approval[] }>("/api/approvals"),

  /**
   * Answers one. Throws `AlreadyAnswered` when the terminal got there first,
   * which is a race someone should see as one rather than as a failure.
   */
  answerApproval: async (id: string, deviceId: string, approved: boolean) => {
    try {
      return await request<{ ok: true }>(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, approved }),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("(409)")) {
        throw new AlreadyAnswered("That was already answered somewhere else.");
      }
      throw error;
    }
  },

  clients: () => request<Client[]>("/api/clients"),
  accountClients: () => request<AccountClient[]>("/api/account-clients"),

  /** The whole access list, not a delta: what is missing is revoked. */
  setAccountClientProjects: (clientId: string, projectIds: string[]) =>
    request<{ ok: true }>("/api/account-clients/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, projectIds }),
    }),

  revokeClient: (id: string) => request<{ ok: true }>(`/api/clients/${id}`, { method: "DELETE" }),

  /** Only accepted once the client is revoked; the server returns 409 if not. */
  deleteClient: (id: string) =>
    request<{ ok: true }>(`/api/clients/${id}/permanently`, { method: "DELETE" }),

  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
  adminUsers: () => request<AdminUserSummary[]>("/api/admin/users"),
  adminUser: (id: string) => request<AdminUserDetail>(`/api/admin/users/${id}`),

  adminRevokeDevice: (userId: string, deviceId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/devices/${deviceId}`, { method: "DELETE" }),

  adminRevokeClient: (userId: string, clientId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/clients/${clientId}`, { method: "DELETE" }),

  adminDeleteUser: (userId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}`, { method: "DELETE" }),
};

/** The gateway's answer, from a connection and a disconnection it recorded. */
export function isOnline(device: Device): boolean {
  return device.revokedAt === null && device.online;
}

export function relativeTime(timestamp: number | null): string {
  if (timestamp === null) return "never";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

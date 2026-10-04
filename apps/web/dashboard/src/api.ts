import type {
  AccountClient,
  AdminOverview,
  AdminUserDetail,
  AdminUserSummary,
  Approval,
  Client,
  CommandPolicy,
  Device,
  ExtensionStatus,
  GitDiff,
  GitStatus,
  Project,
  ToolCallFilters,
  ToolCallPage,
  User,
  Workspace,
  WorkspaceAction,
  WorkspaceCapabilities,
  WorkspaceMutationResult,
} from "./api-types.js";
import { storedToken } from "./auth.js";

export * from "./api-types.js";

export class Unauthorized extends Error {}

/**
 * A refusal from the gateway, kept whole.
 *
 * The message is the sentence a toast shows. The status, the code and the body
 * are for the places that answer a refusal with something other than a toast: a
 * dialog that stays open and says why, or a removal that offers to go ahead
 * anyway.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: Record<string, unknown> | null;

  constructor(status: number, body: Record<string, unknown> | null) {
    super(`${apiError(body)} (${status}).`);
    this.status = status;
    this.code = typeof body?.error === "string" ? body.error : null;
    this.body = body;
  }

  /** The gateway's own sentence, without the status a toast appends to it. */
  get sentence(): string {
    const text = apiError(this.body);
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }
}

/** What to show for a failure: the gateway's sentence when it sent one. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.sentence;
  return error instanceof Error ? error.message : fallback;
}

/**
 * Where requests go and what they carry. The dashboard is served by the
 * gateway and keeps its token in the tab; the Chrome extension's side panel
 * reuses these screens from another origin, with a token it refreshes itself.
 * The ChatGPT app holds no token at all: its host carries each request to the
 * gateway as a tool call, which `transport` stands for.
 */
export type ApiSession =
  | {
      /** Prefixed to every path. Empty for the dashboard, which is same-origin. */
      origin: string;
      token: () => Promise<string | null>;
    }
  | {
      /** Answers a gateway path as the gateway would, already signed in. */
      transport: (path: string, init: RequestInit) => Promise<Response>;
    };

let session: ApiSession = { origin: "", token: async () => storedToken() };

export function configureApiSession(next: ApiSession): void {
  session = next;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);

  // The token expired or was revoked while the tab was open; the caller sends
  // the user back through sign-in rather than showing a broken page.
  if (response.status === 401) throw new Unauthorized("Session expired.");
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .then((value) => value as Record<string, unknown>)
      .catch(() => null);
    throw new ApiError(response.status, body);
  }

  return (await response.json()) as T;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  if ("transport" in session) return session.transport(path, init);

  const token = await session.token();
  if (!token) throw new Unauthorized("Not signed in.");
  return fetch(`${session.origin}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
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
    cloud_disabled: "Exeora Cloud is not enabled for this account. An administrator enables it",
    no_machine: "That location has no machine to be the default",
    machine_removed: "That machine was removed, so it cannot be the default",
    slug_conflict: "That slug is already taken",
    not_retryable: "That instance is not in a state that can be retried",
    github_disabled: "GitHub is not set up on this gateway",
    not_found: "That item no longer exists",
    not_revoked: "Revoke this item before deleting it permanently",
    forbidden: "This account is not allowed to do that",
  };
  return (code && messages[code]) ?? "The gateway could not complete the request";
}

/** Thrown when the terminal answered first. Not an error worth a red banner. */
export class AlreadyAnswered extends Error {}

export const api = {
  me: () => request<User>("/api/me"),
  projects: () => request<Project[]>("/api/projects"),
  workspaces: (projectId: string) => request<Workspace[]>(`/api/projects/${projectId}/workspaces`),
  workspaceCapabilities: (id: string, workspace?: string) =>
    request<WorkspaceCapabilities>(
      `/api/projects/${id}/workspace/capabilities${workspaceTarget(workspace)}`,
    ),
  gitStatus: (id: string, workspace?: string, signal?: AbortSignal) =>
    request<GitStatus>(`/api/projects/${id}/workspace/status${workspaceTarget(workspace)}`, {
      signal,
    }),
  gitDiff: (
    id: string,
    path: string,
    area: "working" | "staged",
    workspace?: string,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ path, area });
    if (workspace) query.set("workspace", workspace);
    return request<GitDiff>(`/api/projects/${id}/workspace/diff?${query}`, { signal });
  },
  workspaceAction: (id: string, action: WorkspaceAction, workspace?: string) =>
    request<WorkspaceMutationResult>(
      `/api/projects/${id}/workspace/actions${workspaceTarget(workspace)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      },
    ),
  terminalTicket: (id: string, workspace?: string) =>
    request<{ url: string; expiresInMs: number }>(
      `/api/projects/${id}/terminal-ticket${workspaceTarget(workspace)}`,
      { method: "POST" },
    ),
  /** A one-use ticket to watch, live, the calls agents make on a root or workspace. */
  logsTicket: (id: string, workspace?: string) =>
    request<{ url: string; expiresInMs: number }>(
      `/api/projects/${id}/logs-ticket${workspaceTarget(workspace)}`,
      { method: "POST" },
    ),
  terminals: () =>
    request<{ items: import("./workspacePaths.js").ListedTerminal[] }>("/api/terminals"),
  closeTerminal: (id: string, workspace?: string) =>
    request<{ closed: boolean }>(`/api/projects/${id}/terminal${workspaceTarget(workspace)}`, {
      method: "DELETE",
    }),

  toolCalls: (filters: ToolCallFilters = {}, cursor?: string) => {
    const query = new URLSearchParams();
    if (filters.projectId) query.set("projectId", filters.projectId);
    if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
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

  setAccountClientProjects: (clientId: string, projectIds: string[], allProjects = false) =>
    request<{ ok: true }>("/api/account-clients/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, projectIds, allProjects }),
    }),

  extension: () => request<ExtensionStatus>("/api/extension"),
  /** Signs every side panel out; the next sign-in asks for consent again. */
  revokeExtension: () => request<{ ok: true }>("/api/extension", { method: "DELETE" }),

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

function workspaceTarget(workspace?: string): string {
  return workspace ? `?${new URLSearchParams({ workspace })}` : "";
}

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

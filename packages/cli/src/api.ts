import type { CommandPolicy } from "@exeora/protocol";
import { accessToken } from "./auth/tokens.js";
import { gatewayUrl } from "./config.js";

/** Typed calls against the gateway's authenticated API. */

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  cliVersion: string | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface ProjectView {
  id: string;
  slug: string;
  name: string;
  deviceId: string;
  localPath: string;
  mcpUrl: string;
  /** What the account allows here. A local `exeora.toml` can only narrow it. */
  policy: CommandPolicy;
  createdAt: number;
}

export interface PlanLimits {
  maxDevices: number | null;
  maxProjects: number | null;
  retentionDays: number;
}

export interface UserView {
  id: string;
  email: string;
  name: string | null;
  plan?: "free" | "pro";
  limits?: PlanLimits;
  usage?: {
    devices: number;
    projects: number;
    toolCallsMonth: number;
  };
}

/** One row of the audit log. Never carries a tool's arguments or its output. */
export interface ToolCallView {
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

/** What the gateway answers with: one page of the log and the way to the next. */
export interface ToolCallsPage {
  items: ToolCallView[];
  cursor: string | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(new URL(path, gatewayUrl()), {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatGatewayError(init.method ?? "GET", path, response.status, detail));
  }
  return (await response.json()) as T;
}

/**
 * Turn a gateway error body into something a person can act on.
 *
 * Most failures stay as the status and a short body slice. `plan_limit` is
 * special because the CLI is the place someone hits the cap first (registering
 * a machine or a project), and dumping JSON at them is not an answer.
 */
function formatGatewayError(method: string, path: string, status: number, detail: string): string {
  try {
    const body = JSON.parse(detail) as {
      error?: string;
      limit?: string;
      max?: number;
      plan?: string;
    };
    if (body.error === "plan_limit" && body.limit && typeof body.max === "number") {
      if (body.limit === "devices") {
        return (
          `Your ${body.plan ?? "current"} plan allows ${body.max} live machines. ` +
          "Revoke one from the dashboard before registering another."
        );
      }
      if (body.limit === "projects") {
        return (
          `Your ${body.plan ?? "current"} plan allows ${body.max} projects. ` +
          "Remove one from the dashboard before adding another."
        );
      }
    }
  } catch {
    // Body was not JSON; fall through to the generic form.
  }
  return `${method} ${path} failed (${status}): ${detail.slice(0, 200)}`;
}

export const gateway = {
  me: () => request<UserView>("/api/me"),

  listDevices: () => request<DeviceView[]>("/api/devices"),

  registerDevice: (body: { name: string; platform: string; cliVersion?: string }) =>
    request<{ id: string; name: string }>("/api/devices", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  revokeDevice: (id: string) => request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),

  listProjects: () => request<ProjectView[]>("/api/projects"),

  addProject: (body: { deviceId: string; name: string; slug: string; localPath: string }) =>
    request<{ id: string; slug: string; name: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  removeProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),

  /**
   * Newest first. The gateway pages the audit log with a cursor rather than
   * taking a limit, so "the newest N" means walking pages until N rows have
   * accumulated or the log runs out.
   */
  listToolCalls: async (limit: number): Promise<ToolCallView[]> => {
    const calls: ToolCallView[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page: ToolCallsPage = await request<ToolCallsPage>(`/api/tool-calls${query}`);
      calls.push(...page.items);
      // An empty page means the log is exhausted, cursor or not: following it
      // further would re-ask forever.
      cursor = page.items.length === 0 ? null : page.cursor;
    } while (cursor !== null && calls.length < limit);
    return calls.slice(0, limit);
  },
};

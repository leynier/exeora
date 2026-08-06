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
  createdAt: number;
}

export interface UserView {
  id: string;
  email: string;
  name: string | null;
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
    throw new Error(
      `${init.method ?? "GET"} ${path} failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
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
};

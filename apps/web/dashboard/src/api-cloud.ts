import { request } from "./api.js";

/**
 * Exeora Cloud: repositories on machines Exeora runs.
 *
 * Every mutation here answers 202 and the machine settles on its own; the
 * list is what a page polls until it does. The shapes mirror the gateway's
 * `cloud/views.ts` field for field.
 */

export type CloudMachineStatus = "creating" | "ready" | "error" | "destroying";

export interface CloudMachine {
  deviceId: string;
  /** Null for the machine that holds the default branch, listed as `main`. */
  workspaceId: string | null;
  workspaceSlug: string;
  branch: string | null;
  status: CloudMachineStatus;
  /** What the machine is doing right now, while it is being created. */
  step: string | null;
  error: string | null;
  online: boolean;
  createdAt: number;
  readyAt: number | null;
}

export interface CloudProject {
  projectId: string;
  slug: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  hasCredential: boolean;
  machines: CloudMachine[];
}

export interface CreateCloudProjectInput {
  name: string;
  slug: string;
  repoUrl: string;
  defaultBranch: string;
  token?: string;
  username?: string;
}

export interface CreateCloudWorkspaceInput {
  branch: string;
  from?: string;
  name?: string;
  slug?: string;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const cloudApi = {
  projects: () => request<{ projects: CloudProject[] }>("/api/cloud/projects"),

  createProject: (input: CreateCloudProjectInput) =>
    request<{ projectId: string; deviceId: string; status: "creating" }>("/api/cloud/projects", {
      method: "POST",
      ...json(input),
    }),

  /** Takes every machine of the project down, the default branch's last. */
  removeProject: (projectId: string) =>
    request<{ ok: true }>(`/api/cloud/projects/${projectId}`, { method: "DELETE" }),

  createWorkspace: (projectId: string, input: CreateCloudWorkspaceInput) =>
    request<{ workspaceId: string; deviceId: string; slug: string; status: "creating" }>(
      `/api/cloud/projects/${projectId}/workspaces`,
      { method: "POST", ...json(input) },
    ),

  removeWorkspace: (projectId: string, workspaceId: string) =>
    request<{ ok: true }>(`/api/cloud/projects/${projectId}/workspaces/${workspaceId}`, {
      method: "DELETE",
    }),

  /** Only accepted for a machine in `error`; the server returns 409 otherwise. */
  retryMachine: (deviceId: string) =>
    request<{ ok: true; status: "creating" }>(`/api/cloud/machines/${deviceId}/retry`, {
      method: "POST",
    }),

  /** Reaches machines created or retried from now on, not the ones running. */
  setCredential: (projectId: string, token: string | null, username?: string) =>
    request<{ ok: true }>(`/api/cloud/projects/${projectId}/credential`, {
      method: "PUT",
      ...json(username ? { token, username } : { token }),
    }),

  adminSetCloud: (userId: string, enabled: boolean) =>
    request<{ ok: true; cloudEnabled: boolean }>(`/api/admin/users/${userId}/cloud`, {
      method: "PUT",
      ...json({ enabled }),
    }),
};

/** Whether the list should keep polling: something is still on its way. */
export function cloudInFlight(projects: CloudProject[]): boolean {
  return projects.some((project) =>
    project.machines.some(
      (machine) => machine.status === "creating" || machine.status === "destroying",
    ),
  );
}

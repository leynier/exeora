import { request } from "./api.js";

/**
 * What only Exeora Cloud has: an instance that failed can be tried again, and
 * a project that was added by address clones with a token kept here.
 *
 * Everything else about Cloud is a location like any other and lives in
 * `api-projects.ts`.
 */

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const cloudApi = {
  /** Only accepted for an instance that failed; the server returns 409 otherwise. */
  retryMachine: (deviceId: string) =>
    request<{ ok: true; status: "creating" }>(`/api/cloud/machines/${deviceId}/retry`, {
      method: "POST",
    }),

  /** Reaches instances created or retried from now on, not the ones running. */
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

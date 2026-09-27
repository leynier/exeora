import { request } from "./api.js";
import type { CloudHook, CloudScripts, CloudScriptsInput } from "./api-types.js";

/**
 * What only Exeora Cloud has: an instance that failed can be tried again, a
 * project that was added by address clones with a token kept here, and a
 * project runs scripts of its own inside its instances.
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

  getScripts: (projectId: string) =>
    request<CloudScripts>(`/api/projects/${projectId}/cloud-scripts`),

  /**
   * Changes no instance at that moment: each is told the scripts the next time
   * it resumes. Refused with the hook by name when a script is too large.
   */
  setScripts: (projectId: string, scripts: CloudScriptsInput) =>
    request<CloudScripts>(`/api/projects/${projectId}/cloud-scripts`, {
      method: "PUT",
      ...json(scripts),
    }),

  /** Asks the instance to run a script now. The result arrives with the list of machines. */
  runHook: (deviceId: string, hook: CloudHook) =>
    request<{ ok: true }>(`/api/cloud/machines/${deviceId}/hooks/${hook}/run`, {
      method: "POST",
    }),

  adminSetCloud: (userId: string, enabled: boolean) =>
    request<{ ok: true; cloudEnabled: boolean }>(`/api/admin/users/${userId}/cloud`, {
      method: "PUT",
      ...json({ enabled }),
    }),
};

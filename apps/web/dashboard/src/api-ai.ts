import { request } from "./api.js";

/**
 * AI Assist: which providers an account may link and has linked, what each
 * operation is generated with, and the generations themselves. Restated
 * from the gateway's `src/ai/` routes.
 */

export type AiProviderId = "openai" | "xai";
export type AiAuthKind = "oauth" | "api_key";
export type AiOperation = "commit" | "pull_request";

export interface AiModel {
  id: string;
  label: string;
}

export interface AiProviderView {
  id: AiProviderId;
  label: string;
  authKinds: AiAuthKind[];
  linked: { kind: AiAuthKind; accountLabel: string | null } | null;
  models: AiModel[];
}

export interface AiOperationSettings {
  provider: AiProviderId | null;
  model: string | null;
  instructions: string | null;
}

export interface AiSettings {
  defaultProvider: AiProviderId | null;
  operations: Record<AiOperation, AiOperationSettings>;
}

export interface AiStatus {
  enabled: boolean;
  providers: AiProviderView[];
  settings: AiSettings | null;
  oauthAvailable: boolean;
}

export interface AiDeviceLogin {
  userCode: string;
  verificationUrl: string;
  /** Seconds between polls. */
  interval: number;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type AiDevicePoll =
  | { status: "pending" }
  | { status: "granted"; linked: { kind: "oauth"; accountLabel: string | null } }
  | { status: "denied" | "expired" };

export interface AiSettingsPatch {
  defaultProvider?: AiProviderId | null;
  operations?: Partial<Record<AiOperation, Partial<AiOperationSettings>>>;
}

export interface AiCommitMessage {
  message: string;
  provider: AiProviderId;
  model: string;
}

export interface AiPullRequestText {
  title: string;
  body: string;
  provider: AiProviderId;
  model: string;
}

const json = (body: unknown, method = "POST", signal?: AbortSignal): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

export const aiApi = {
  status: () => request<AiStatus>("/api/ai"),
  startDeviceLogin: (provider: AiProviderId) =>
    request<AiDeviceLogin>(`/api/ai/providers/${provider}/device`, json({})),
  pollDeviceLogin: (provider: AiProviderId) =>
    request<AiDevicePoll>(`/api/ai/providers/${provider}/device/poll`, json({})),
  setKey: (provider: AiProviderId, key: string) =>
    request<{ linked: { kind: "api_key" } }>(
      `/api/ai/providers/${provider}/key`,
      json({ key }, "PUT"),
    ),
  unlink: (provider: AiProviderId) =>
    request<{ ok: true }>(`/api/ai/providers/${provider}`, { method: "DELETE" }),
  models: (provider: AiProviderId) =>
    request<{ models: AiModel[] }>(`/api/ai/providers/${provider}/models`),
  saveSettings: (patch: AiSettingsPatch) =>
    request<AiSettings>("/api/ai/settings", json(patch, "PUT")),
  commitMessage: (
    projectId: string,
    provider: AiProviderId | undefined,
    workspace: string | undefined,
    signal: AbortSignal,
  ) =>
    request<AiCommitMessage>(
      `/api/projects/${projectId}/ai/commit-message${target(workspace)}`,
      json(provider ? { provider } : {}, "POST", signal),
    ),
  pullRequest: (
    projectId: string,
    provider: AiProviderId | undefined,
    base: string,
    workspace: string | undefined,
    signal: AbortSignal,
  ) =>
    request<AiPullRequestText>(
      `/api/projects/${projectId}/ai/pull-request${target(workspace)}`,
      json(provider ? { provider, base } : { base }, "POST", signal),
    ),
};

function target(workspace: string | undefined): string {
  return workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
}

export const aiKeys = {
  status: ["ai"] as const,
  models: (provider: AiProviderId) => ["ai", "models", provider] as const,
};

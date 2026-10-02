import { request } from "./api.js";

/**
 * AI Assist: which providers an account may link and has linked, what each
 * operation is generated with, and the generations themselves. Restated
 * from the gateway's `src/ai/` routes.
 */

export type AiProviderId = "openai" | "xai" | "chatgpt";
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
  /** Machine-bound providers do not create an account-level credential row. */
  machineBound?: boolean;
  linked: { kind: AiAuthKind; accountLabel: string | null; legacy?: boolean } | null;
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

export type ChatgptLoginMode = "new" | "reauth" | "enable_plan";

export type ChatgptState =
  | "signed_out"
  | "pending"
  | "ready"
  | "plan_disabled"
  | "reconnect"
  | "client_invalid"
  | "unavailable_on_cloud";

export type ChatgptLoginError =
  | "login_timeout"
  | "state_mismatch"
  | "plan_disabled"
  | "missing_code"
  | "registration_incomplete"
  | "client_mismatch"
  | "temporarily_unavailable"
  | "invalid_token_response"
  | "invalid_id_token"
  | "subject_mismatch"
  | "reconnect"
  | "client_invalid"
  | "cancelled";

export interface ChatgptAccount {
  label: string;
  email: string | null;
  scopes: string[];
  planUsage: boolean;
  newRegistration: boolean;
  noticeId?: string;
}

export interface ChatgptPending {
  /** Epoch milliseconds; the dashboard stops polling after this time. */
  expiresAt: number;
}

export interface ChatgptStatus {
  state: ChatgptState;
  account?: ChatgptAccount;
  pending?: ChatgptPending;
  /** Safe, static reason for the most recent failed login attempt. */
  loginError?: ChatgptLoginError | null;
}

export interface ChatgptLogin {
  authorizeUrl: string;
  /** Epoch milliseconds for the one pending loopback attempt. */
  expiresAt: number;
}

export interface ChatgptModels {
  models: AiModel[];
}

export interface ChatgptLogout {
  revocationConfirmed: boolean;
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
  chatgptStatus: (deviceId: string) =>
    request<ChatgptStatus>(`/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt`),
  chatgptLogin: (deviceId: string, mode: ChatgptLoginMode) =>
    request<ChatgptLogin>(
      `/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt/login`,
      json({ mode }),
    ),
  chatgptCancel: (deviceId: string) =>
    request<ChatgptStatus>(
      `/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt/login/cancel`,
      json({}),
    ),
  chatgptWelcomeAck: (deviceId: string, noticeId: string) =>
    request<{ acknowledged: boolean }>(
      `/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt/welcome`,
      json({ noticeId }),
    ),
  chatgptLogout: (deviceId: string) =>
    request<ChatgptLogout>(
      `/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt/logout`,
      json({}),
    ),
  chatgptModels: (deviceId: string) =>
    request<ChatgptModels>(`/api/devices/${encodeURIComponent(deviceId)}/ai/chatgpt/models`),
  chatgptProjectStatus: (projectId: string, workspace?: string) =>
    request<ChatgptStatus & { deviceId?: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/chatgpt${target(workspace)}`,
    ),
  chatgptProjectLogin: (projectId: string, mode: ChatgptLoginMode, workspace?: string) =>
    request<ChatgptLogin>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/chatgpt/login${target(workspace)}`,
      json({ mode }),
    ),
  chatgptProjectCancel: (projectId: string, workspace?: string) =>
    request<ChatgptStatus>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/chatgpt/login/cancel${target(workspace)}`,
      json({}),
    ),
  chatgptProjectLogout: (projectId: string, workspace?: string) =>
    request<ChatgptLogout>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/chatgpt/logout${target(workspace)}`,
      json({}),
    ),
  chatgptProjectModels: (projectId: string, workspace?: string) =>
    request<ChatgptModels>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/chatgpt/models${target(workspace)}`,
    ),
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
  chatgptStatus: (deviceId: string) => ["ai", "chatgpt", deviceId, "status"] as const,
  chatgptModels: (deviceId: string) => ["ai", "chatgpt", deviceId, "models"] as const,
  chatgptProjectStatus: (projectId: string, workspace?: string) =>
    ["ai", "chatgpt", "project", projectId, workspace ?? "", "status"] as const,
};

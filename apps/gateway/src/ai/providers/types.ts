import type { AiAuthKind, AiOperation, AiProviderId } from "../../db/schema-ai.js";
import "../../env.js";

export type { AiAuthKind, AiOperation, AiProviderId };

/**
 * What every provider looks like from the routes: a way to link an account
 * by device code or by API key, a way to keep the link alive, and a way to
 * ask for text. Each takes the fetcher first, the way `github/` does: the
 * workers tests refuse outbound requests, so a test hands in a fake.
 */

/** The variables a provider may read. Only xAI's OAuth needs one today. */
export type AiEnv = Pick<
  Env,
  "AI_ASSIST_PROVIDERS" | "AI_ASSIST_OAUTH" | "XAI_OAUTH_CLIENT_ID" | "CLOUD_CREDENTIALS_KEY"
>;

/** What a provider grants: the token, and what it will need beside it. */
export interface GrantedTokens {
  access: string;
  refresh?: string | undefined;
  /** Milliseconds since the epoch, or undefined for a token that does not expire. */
  expiresAt?: number | undefined;
  /** What the provider routes by beside the token, such as a ChatGPT account id. */
  accountId?: string | undefined;
  /** Something to show the person, such as the account's email. */
  accountLabel?: string | undefined;
}

/** A device login as it was started: what the person is shown, and what the poll needs. */
export interface DeviceLoginStart {
  deviceId: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds between polls. */
  interval: number;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** What the flow has to keep secret until it is granted. Stored encrypted. */
  secret?: string | undefined;
}

/** What a poll needs of a login that was started. */
export type DeviceLogin = Pick<DeviceLoginStart, "deviceId" | "userCode" | "secret">;

export type DevicePoll =
  | { status: "pending" }
  | { status: "granted"; tokens: GrantedTokens }
  | { status: "denied" }
  | { status: "expired" };

/** A credential as it is handed to a request: opened, and with what routes it. */
export interface Credential {
  kind: AiAuthKind;
  access: string;
  accountId?: string | undefined;
}

export interface AiModel {
  id: string;
  label: string;
}

export interface GenerateRequest {
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  /** A local-machine provider never creates an account credential row. */
  machineBound?: boolean;
  /** What the provider can link by at all. `aiConfig` narrows it by what the gateway allows. */
  authKinds: readonly AiAuthKind[];
  /** Whether the gateway holds what the OAuth flow needs. Absent means it always does. */
  oauthConfigured?: (env: AiEnv) => boolean;
  /** Absent for documented API-key-only providers. */
  startDeviceLogin?: (fetcher: typeof fetch, env: AiEnv) => Promise<DeviceLoginStart>;
  /** Absent for documented API-key-only providers. */
  pollDeviceLogin?: (fetcher: typeof fetch, env: AiEnv, login: DeviceLogin) => Promise<DevicePoll>;
  /** Absent for documented API-key-only providers. */
  refresh?: (fetcher: typeof fetch, env: AiEnv, refreshToken: string) => Promise<GrantedTokens>;
  validateKey(fetcher: typeof fetch, key: string): Promise<{ accountLabel?: string | undefined }>;
  listModels(fetcher: typeof fetch, credential: Credential): Promise<AiModel[]>;
  generate(
    fetcher: typeof fetch,
    credential: Credential,
    request: GenerateRequest,
  ): Promise<string>;
}

export type AiErrorKind =
  /** The provider did not answer, or answered with something that is not what was asked. */
  | "unavailable"
  /** The provider no longer takes the credential: link again. */
  | "reconnect"
  /** The key the person typed is not one the provider accepts. */
  | "invalid_key"
  /** The account never linked this provider. */
  | "not_linked"
  /** A credential row was written by a retired integration and is display-only. */
  | "legacy";

/**
 * Where a provider is the problem. `message` is a sentence that can be shown
 * to the person as it is: it never quotes a response body, which may echo
 * what was sent, and what was sent is the person's diff.
 */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

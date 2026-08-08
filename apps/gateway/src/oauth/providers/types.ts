/**
 * The seam that keeps identity providers interchangeable.
 *
 * Each provider verifies the identity fields before returning them, so the
 * routes and account resolution never have to know provider-specific shapes.
 */

export interface UpstreamIdentity {
  /** Stable id at the provider. Never an email: emails change hands. */
  providerUserId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface UpstreamProvider {
  readonly id: ProviderId;
  readonly label: string;

  /** False when the provider's secrets are absent, so it can be hidden. */
  isConfigured(env: Env): boolean;

  authorizeUrl(env: Env, options: { redirectUri: string; state: string }): string;

  /** Trades the authorization code for an upstream access token. */
  exchangeCode(env: Env, options: { code: string; redirectUri: string }): Promise<string>;

  fetchIdentity(accessToken: string): Promise<UpstreamIdentity>;
}

/**
 * Widening this union is all the type system needs to accept a second
 * provider: `oauth_identities.provider` is a plain TEXT column in SQLite, so
 * the Drizzle enum is a compile-time constraint only and adding a value
 * produces no migration.
 */
export type ProviderId = "github" | "google";

export class UpstreamAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamAuthError";
  }
}

import { gatewayUrl } from "../config.js";
import { discoverClient } from "./client.js";
import { clearCredentials, loadCredentials } from "./store.js";

/**
 * Access tokens on demand.
 *
 * Only the refresh token is persisted. Access tokens are short-lived and kept
 * in memory, so a stolen keychain entry is still bounded by the gateway's
 * ability to revoke the device.
 */

let cached: { token: string; expiresAt: number } | null = null;

/** Refresh this far before expiry, so a call never races the clock. */
const EARLY_REFRESH_MS = 60_000;

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in. Run `exeora login` first.");
    this.name = "NotSignedInError";
  }
}

export function cacheAccessToken(token: string, expiresAt: number): void {
  cached = { token, expiresAt };
}

export function forgetAccessToken(): void {
  cached = null;
}

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - EARLY_REFRESH_MS > Date.now()) {
    return cached.token;
  }

  const credentials = await loadCredentials();
  if (!credentials) throw new NotSignedInError();

  const gateway = gatewayUrl();
  // A token from a different gateway is useless here and would fail with a
  // confusing 401, so say what actually happened.
  if (credentials.issuer !== new URL(gateway).origin) {
    throw new Error(
      `You are signed in to ${credentials.issuer}, but the configured gateway is ${gateway}. Run \`exeora login\` again.`,
    );
  }

  const client = await discoverClient(gateway);

  const response = await fetch(client.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.clientId,
      refresh_token: credentials.refreshToken,
    }),
  });

  if (response.status === 400 || response.status === 401) {
    // The refresh token was revoked or expired. Drop it so the next command
    // says "not signed in" instead of failing the same way forever.
    await clearCredentials();
    throw new NotSignedInError();
  }
  if (!response.ok) {
    throw new Error(`Could not refresh the session (${response.status}).`);
  }

  const tokens = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) throw new Error("The gateway returned no access token.");

  cached = {
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

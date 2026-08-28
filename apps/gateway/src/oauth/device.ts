import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { CLI_SCOPES, cliDeviceRedirectUri, isCliClient } from "./clients.js";

/**
 * Headless CLI sign-in. The terminal shows a short code; a browser elsewhere
 * opens the verification URL, signs in, and consents. The CLI polls until that
 * happens, then exchanges the minted authorization code with PKCE.
 *
 * Not RFC 8628's token endpoint: Cloudflare's provider does not speak
 * `urn:ietf:params:oauth:grant-type:device_code`, so this mints an
 * authorization code the CLI redeems at `/oauth/token` like the loopback
 * flow. Device and user codes themselves are never stored; only HMACs of
 * those land in D1. The minted authorization code is stored until the CLI
 * consumes it; PKCE is what stops a D1 read from redeeming it.
 */

export const DEVICE_TTL_SECONDS = 600;
export const DEVICE_INTERVAL_SECONDS = 5;
const USER_CODE_LENGTH = 8;
const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface CreatedDeviceGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthRequest {
  responseType: "code";
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  issuer: string;
}

export interface RedeemedDeviceGrant {
  authorizationCode: string;
  redirectUri: string;
  issuer: string | null;
}

export type DevicePollResult =
  | {
      error:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token"
        | "invalid_grant";
    }
  | { ok: RedeemedDeviceGrant };

export async function createDeviceGrant(
  env: Env,
  input: { clientId: string; codeChallenge: string; codeChallengeMethod: string; scope: string[] },
): Promise<CreatedDeviceGrant | { error: string }> {
  if (!(await isCliClient(env, input.clientId))) {
    return { error: "Only the Exeora CLI can start a code sign-in." };
  }
  if (input.codeChallengeMethod !== "S256" || !isPkceChallenge(input.codeChallenge)) {
    return { error: "A S256 PKCE challenge is required." };
  }

  const scopes = CLI_SCOPES.filter((scope) => input.scope.includes(scope));
  if (scopes.length === 0) {
    return { error: "This application did not request a scope it is allowed to use." };
  }

  const deviceCode = randomToken(32);
  const redirectUri = cliDeviceRedirectUri(env);
  const expiresAt = new Date(Date.now() + DEVICE_TTL_SECONDS * 1000);
  const deviceCodeHash = await tokenHash(deviceCode, env.COOKIE_SECRET);

  let userCode = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    userCode = randomUserCode();
    try {
      await db(env)
        .insert(schema.oauthDeviceGrants)
        .values({
          deviceCodeHash,
          userCodeHash: await tokenHash(normalizeUserCode(userCode), env.COOKIE_SECRET),
          clientId: input.clientId,
          codeChallenge: input.codeChallenge,
          codeChallengeMethod: input.codeChallengeMethod,
          scopes: scopes.join(" "),
          redirectUri,
          status: "pending",
          intervalSeconds: DEVICE_INTERVAL_SECONDS,
          expiresAt,
        })
        .run();
      break;
    } catch (error) {
      if (attempt === 7 || !isUniqueViolation(error)) throw error;
    }
  }

  return {
    deviceCode,
    userCode,
    verificationUri: new URL("/oauth/device", env.EXEORA_BASE_URL).toString(),
    expiresIn: DEVICE_TTL_SECONDS,
    interval: DEVICE_INTERVAL_SECONDS,
  };
}

export async function lookupDeviceGrantByUserCode(
  env: Env,
  userCode: string,
): Promise<{ deviceCodeHash: string; authRequest: DeviceAuthRequest } | null> {
  const normalized = normalizeUserCode(userCode);
  if (normalized.length !== USER_CODE_LENGTH) return null;

  const row = await db(env)
    .select({
      deviceCodeHash: schema.oauthDeviceGrants.deviceCodeHash,
      clientId: schema.oauthDeviceGrants.clientId,
      codeChallenge: schema.oauthDeviceGrants.codeChallenge,
      codeChallengeMethod: schema.oauthDeviceGrants.codeChallengeMethod,
      scopes: schema.oauthDeviceGrants.scopes,
      redirectUri: schema.oauthDeviceGrants.redirectUri,
      status: schema.oauthDeviceGrants.status,
    })
    .from(schema.oauthDeviceGrants)
    .where(
      and(
        eq(schema.oauthDeviceGrants.userCodeHash, await tokenHash(normalized, env.COOKIE_SECRET)),
        eq(schema.oauthDeviceGrants.status, "pending"),
        gt(schema.oauthDeviceGrants.expiresAt, new Date()),
      ),
    )
    .get();

  if (!row) return null;

  return {
    deviceCodeHash: row.deviceCodeHash,
    authRequest: {
      responseType: "code",
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      scope: row.scopes.split(" ").filter(Boolean),
      state: "",
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
      issuer: new URL(env.EXEORA_BASE_URL).origin,
    },
  };
}

/** Consumes the user code so a second tab cannot start a parallel consent. */
export async function beginDeviceAuthorization(env: Env, deviceCodeHash: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE oauth_device_grants SET status = 'completing' " +
      "WHERE device_code_hash = ?1 AND status = 'pending' AND expires_at > ?2",
  )
    .bind(deviceCodeHash, Date.now())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function captureDeviceAuthorization(
  env: Env,
  deviceCodeHash: string,
  redirectTo: string,
): Promise<boolean> {
  const url = new URL(redirectTo);
  const authorizationCode = url.searchParams.get("code");
  if (!authorizationCode) return false;

  const result = await env.DB.prepare(
    "UPDATE oauth_device_grants SET status = 'authorized', authorization_code = ?1, issuer = ?2 " +
      "WHERE device_code_hash = ?3 AND status = 'completing' AND expires_at > ?4",
  )
    .bind(authorizationCode, url.searchParams.get("iss"), deviceCodeHash, Date.now())
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function denyDeviceAuthorization(env: Env, deviceCodeHash: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE oauth_device_grants SET status = 'denied' " +
      "WHERE device_code_hash = ?1 AND status = 'completing' AND expires_at > ?2",
  )
    .bind(deviceCodeHash, Date.now())
    .run();
}

export async function pollDeviceGrant(env: Env, deviceCode: string): Promise<DevicePollResult> {
  const now = Date.now();
  const hash = await tokenHash(deviceCode, env.COOKIE_SECRET);

  // One winner per interval, including while the browser is still signing in.
  // The timestamp condition lives in the UPDATE so two concurrent polls cannot
  // both observe the old value and both succeed.
  const waiting = await env.DB.prepare(
    "UPDATE oauth_device_grants SET last_polled_at = ?1 " +
      "WHERE device_code_hash = ?2 AND expires_at > ?1 " +
      "AND status IN ('pending', 'completing') " +
      "AND (last_polled_at IS NULL OR last_polled_at <= ?1 - (interval_seconds * 1000)) " +
      "RETURNING status",
  )
    .bind(now, hash)
    .first<{ status: string }>();
  if (waiting) return { error: "authorization_pending" };

  const row = await db(env)
    .select({
      status: schema.oauthDeviceGrants.status,
      expiresAt: schema.oauthDeviceGrants.expiresAt,
    })
    .from(schema.oauthDeviceGrants)
    .where(eq(schema.oauthDeviceGrants.deviceCodeHash, hash))
    .get();

  if (!row || row.expiresAt.getTime() <= now) return { error: "expired_token" };
  if (row.status === "pending" || row.status === "completing") return { error: "slow_down" };
  if (row.status === "denied") return { error: "access_denied" };
  if (row.status === "consumed") return { error: "invalid_grant" };
  if (row.status !== "authorized") return { error: "authorization_pending" };

  const claimed = await env.DB.prepare(
    "UPDATE oauth_device_grants SET status = 'consumed' " +
      "WHERE device_code_hash = ?1 AND status = 'authorized' AND expires_at > ?2 " +
      "RETURNING authorization_code, redirect_uri, issuer",
  )
    .bind(hash, now)
    .first<{ authorization_code: string; redirect_uri: string; issuer: string | null }>();

  if (!claimed?.authorization_code) return { error: "invalid_grant" };

  return {
    ok: {
      authorizationCode: claimed.authorization_code,
      redirectUri: claimed.redirect_uri,
      issuer: claimed.issuer,
    },
  };
}

export async function purgeExpiredDeviceGrants(env: Pick<Env, "DB">): Promise<void> {
  await env.DB.prepare("DELETE FROM oauth_device_grants WHERE expires_at <= ?1")
    .bind(Date.now())
    .run();
}

export function normalizeUserCode(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^0-9A-Z]/g, "")
    .replaceAll(/[ILOU]/g, "");
}

export function formatUserCode(value: string): string {
  const normalized = normalizeUserCode(value);
  if (normalized.length !== USER_CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

function isPkceChallenge(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH));
  let out = "";
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: masked into alphabet range
    out += USER_CODE_ALPHABET[byte & 31]!;
  }
  return formatUserCode(out);
}

function randomToken(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function tokenHash(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

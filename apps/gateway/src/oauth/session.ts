import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { db, schema } from "../db/client.js";

/**
 * Revocable, opaque browser session for the OAuth consent UI.
 *
 * This is deliberately separate from OAuth access tokens. It only avoids a
 * second upstream sign-in while authorizing another client; API and MCP calls
 * still require their own scoped bearer token.
 */
const COOKIE_NAME = "exeora_session";
const COOKIE_VERSION = "v2";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export async function setSession(c: Context<{ Bindings: Env }>, userId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);

  await db(c.env)
    .insert(schema.browserSessions)
    .values({ idHash: await tokenHash(token, c.env.COOKIE_SECRET), userId, expiresAt })
    .run();

  setCookie(c, COOKIE_NAME, `${COOKIE_VERSION}.${token}`, cookieOptions(c, MAX_AGE_SECONDS));
}

export async function getSessionUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const token = sessionToken(c);
  if (!token) return null;

  const row = await db(c.env)
    .select({ userId: schema.browserSessions.userId })
    .from(schema.browserSessions)
    .where(
      and(
        eq(schema.browserSessions.idHash, await tokenHash(token, c.env.COOKIE_SECRET)),
        gt(schema.browserSessions.expiresAt, new Date()),
        isNull(schema.browserSessions.revokedAt),
      ),
    )
    .get();

  return row?.userId ?? null;
}

export async function clearSession(c: Context<{ Bindings: Env }>): Promise<void> {
  const token = sessionToken(c);
  if (token) {
    await db(c.env)
      .update(schema.browserSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.browserSessions.idHash, await tokenHash(token, c.env.COOKIE_SECRET)))
      .run();
  }
  setCookie(c, COOKIE_NAME, "", cookieOptions(c, 0));
}

export async function purgeBrowserSessions(env: Pick<Env, "DB">): Promise<void> {
  const now = new Date();
  await db(env)
    .delete(schema.browserSessions)
    .where(
      or(
        lt(schema.browserSessions.expiresAt, now),
        and(isNotNull(schema.browserSessions.revokedAt), lt(schema.browserSessions.revokedAt, now)),
      ),
    )
    .run();
}

function sessionToken(c: Context): string | null {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw?.startsWith(`${COOKIE_VERSION}.`)) return null;
  const token = raw.slice(COOKIE_VERSION.length + 1);
  return token.length > 0 ? token : null;
}

function cookieOptions(c: Context<{ Bindings: Env }>, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: new URL(c.env.EXEORA_BASE_URL).protocol === "https:",
    path: "/",
    maxAge,
  };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
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

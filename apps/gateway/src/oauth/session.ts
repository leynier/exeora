import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

/**
 * A signed cookie remembering who is signed in, so approving a second MCP
 * client does not mean a second round-trip through the identity provider.
 *
 * It carries the user id and nothing else. It is not an access token: it only
 * lets `/oauth/authorize` skip the upstream login, and every API and MCP
 * request is authorised by an OAuth token instead.
 */
const COOKIE_NAME = "exeora_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export async function setSession(c: Context<{ Bindings: Env }>, userId: string): Promise<void> {
  const value = `${userId}.${await sign(userId, c.env.COOKIE_SECRET)}`;
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    // The OAuth redirect back from an identity provider is a cross-site top-level
    // navigation, so Strict would drop the cookie exactly when it is needed.
    sameSite: "Lax",
    // Derived from the configured base URL, not from c.req.url: wrangler dev
    // rewrites the request host to the configured route, so reading the
    // protocol off the request could mark the cookie Secure while the browser
    // is on plain-http localhost, which silently drops it mid-login.
    secure: new URL(c.env.EXEORA_BASE_URL).protocol === "https:",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSessionUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = await sign(userId, c.env.COOKIE_SECRET);

  return timingSafeEqual(signature, expected) ? userId : null;
}

export function clearSession(c: Context<{ Bindings: Env }>): void {
  setCookie(c, COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(signature);
}

function base64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Constant-time compare so a forged cookie cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

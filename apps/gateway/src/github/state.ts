import "../env.js";
import { base64Url, decodeBase64 } from "./app.js";

/**
 * The `state` that goes to GitHub with a person and comes back with them.
 *
 * The callback is a navigation from github.com: it carries no access token,
 * so this string is the only thing that says which account asked to connect.
 * It is signed for that reason, and it expires, so a link that was copied
 * somewhere is worth nothing ten minutes later.
 *
 * Signed with `REQUEST_STATE_SECRET`, which also signs approvals. The purpose
 * is part of what is signed, so neither can be passed off as the other.
 */

const PURPOSE = "github-connect";
const TTL_MS = 10 * 60_000;

interface ConnectState {
  /** The account that asked. */
  u: string;
  /** When it stops being accepted, in milliseconds. */
  e: number;
  /** Makes two states of one account in one millisecond differ. */
  n: string;
}

/** What a state that verified says. */
export interface VerifiedState {
  userId: string;
  /** Names this one state, which is how a second use of it is recognised. */
  nonce: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export async function signConnectState(
  env: Pick<Env, "REQUEST_STATE_SECRET">,
  userId: string,
  now: number = Date.now(),
): Promise<string> {
  const state: ConnectState = {
    u: userId,
    e: now + TTL_MS,
    n: base64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(state)));
  const signature = await crypto.subtle.sign("HMAC", await key(env), signed(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

/** What a state was signed with, or null for one that is forged, altered or expired. */
export async function verifyConnectState(
  env: Pick<Env, "REQUEST_STATE_SECRET">,
  state: string | undefined,
  now: number = Date.now(),
): Promise<VerifiedState | null> {
  const [payload, signature, extra] = (state ?? "").split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    // `verify` compares in constant time, which a string comparison does not.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(env),
      decodeBase64(signature),
      signed(payload),
    );
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64(payload))) as ConnectState;
    if (typeof parsed.u !== "string" || parsed.u === "" || typeof parsed.e !== "number") {
      return null;
    }
    if (typeof parsed.n !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(parsed.n)) return null;
    return parsed.e > now ? { userId: parsed.u, nonce: parsed.n, expiresAt: parsed.e } : null;
  } catch {
    return null;
  }
}

const usedKey = (nonce: string) => `github:state:${nonce}`;

/**
 * Spends a state: true the first time, false ever after.
 *
 * Remembered for as long as the state itself would have been accepted, which
 * is all the longer it needs remembering. KV will not keep anything for less
 * than a minute, so the last states of their ten are remembered a little
 * past their end.
 */
export async function consumeConnectState(
  env: Pick<Env, "OAUTH_KV">,
  state: VerifiedState,
  now: number = Date.now(),
): Promise<boolean> {
  const key = usedKey(state.nonce);
  if ((await env.OAUTH_KV.get(key)) !== null) return false;
  const seconds = Math.max(60, Math.ceil((state.expiresAt - now) / 1000));
  await env.OAUTH_KV.put(key, "1", { expirationTtl: seconds });
  return true;
}

function signed(payload: string): Uint8Array {
  return new TextEncoder().encode(`${PURPOSE}\x00${payload}`);
}

async function key(env: Pick<Env, "REQUEST_STATE_SECRET">): Promise<CryptoKey> {
  // Refused rather than signed with an empty key, which anybody could forge.
  if (!env.REQUEST_STATE_SECRET) throw new Error("REQUEST_STATE_SECRET is not set.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.REQUEST_STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

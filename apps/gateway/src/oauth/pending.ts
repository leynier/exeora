import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { newId } from "../ids.js";

/**
 * Parks the in-flight authorization request while the user is away at GitHub.
 *
 * It lives in KV rather than in the `state` parameter because state travels
 * through the provider's URL: keeping the request server-side bounds its size
 * and means a tampered state can only ever fail to resolve, never smuggle a
 * different redirect_uri back into the flow.
 */
const TTL_SECONDS = 600;

export interface PendingAuthorization {
  authRequest: AuthRequest;
}

export async function parkAuthorization(env: Env, pending: PendingAuthorization): Promise<string> {
  const state = newId("req");
  await env.OAUTH_KV.put(key(state), JSON.stringify(pending), {
    expirationTtl: TTL_SECONDS,
  });
  return state;
}

/** Reads without consuming, for the upstream callback that still has to render consent. */
export async function peekAuthorization(
  env: Env,
  state: string,
): Promise<PendingAuthorization | null> {
  const raw = await env.OAUTH_KV.get(key(state));
  return raw ? (JSON.parse(raw) as PendingAuthorization) : null;
}

/**
 * Reads and deletes. Called once, when the user approves, which also makes
 * the unguessable state the CSRF token for the approval form.
 */
export async function claimAuthorization(
  env: Env,
  state: string,
): Promise<PendingAuthorization | null> {
  const pending = await peekAuthorization(env, state);
  if (pending) await env.OAUTH_KV.delete(key(state));
  return pending;
}

function key(state: string): string {
  return `pending_auth:${state}`;
}

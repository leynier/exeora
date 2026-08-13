import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";

/**
 * Parks the in-flight authorization request while the user is away at an identity provider.
 *
 * It lives in D1 rather than in the `state` parameter because state travels
 * through the provider's URL. D1 also gives the final claim an atomic
 * `DELETE ... RETURNING`, so two concurrent approvals cannot mint two codes.
 */
const TTL_SECONDS = 600;

export interface PendingAuthorization {
  authRequest: AuthRequest;
}

export async function parkAuthorization(env: Env, pending: PendingAuthorization): Promise<string> {
  const state = newId("req");
  await db(env)
    .insert(schema.oauthPending)
    .values({
      state,
      payload: JSON.stringify(pending),
      expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
    })
    .run();
  return state;
}

/** Reads without consuming, for the upstream callback that still has to render consent. */
export async function peekAuthorization(
  env: Env,
  state: string,
): Promise<PendingAuthorization | null> {
  const row = await db(env)
    .select({ payload: schema.oauthPending.payload })
    .from(schema.oauthPending)
    .where(and(eq(schema.oauthPending.state, state), gt(schema.oauthPending.expiresAt, new Date())))
    .get();
  return row ? parse(row.payload) : null;
}

/**
 * Reads and deletes. Called once, when the user approves, which also makes
 * the unguessable state the CSRF token for the approval form.
 */
export async function claimAuthorization(
  env: Env,
  state: string,
): Promise<PendingAuthorization | null> {
  const row = await env.DB.prepare(
    "DELETE FROM oauth_pending WHERE state = ?1 AND expires_at > ?2 RETURNING payload",
  )
    .bind(state, Date.now())
    .first<{ payload: string }>();
  return row ? parse(row.payload) : null;
}

export async function purgeExpiredAuthorizations(env: Pick<Env, "DB">): Promise<void> {
  await env.DB.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?1").bind(Date.now()).run();
}

function parse(raw: string): PendingAuthorization | null {
  try {
    const value = JSON.parse(raw) as PendingAuthorization;
    return value?.authRequest ? value : null;
  } catch {
    return null;
  }
}

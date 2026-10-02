import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import type { AiAuthKind, AiProviderId, AiProviderRow } from "../db/schema-ai.js";
import "../env.js";
import {
  type AiEnv,
  AiError,
  type AiProvider,
  type Credential,
  type GrantedTokens,
} from "./providers/types.js";

/**
 * The credential that speaks to a provider as the person, kept encrypted.
 *
 * An OAuth token expires and is renewed with its refresh token, which some
 * providers make good once. Two requests that both find it about to expire
 * both try; the slower one is refused, and what the faster one stored is
 * then the credential to use, not a reason to unlink. Every write is over
 * the row as it was read, the way `github/user-token.ts` does it.
 */

export type CredentialEnv = Pick<Env, "DB">;
export type CredentialKey = { credentialsKey: string };

/** Renewed this long before it expires, so a generation that starts now can finish. */
export const RENEW_MARGIN_MS = 5 * 60_000;

/** What the dashboard is told of a link: never the secret. */
export interface LinkedProvider {
  provider: AiProviderId;
  kind: AiAuthKind;
  accountLabel: string | null;
  /** True for the retired OpenAI/Codex OAuth link, which is display-only. */
  legacy?: true;
}

export async function linkedProviders(
  env: CredentialEnv,
  userId: string,
): Promise<LinkedProvider[]> {
  const rows = await db(env)
    .select({
      provider: schema.aiProviders.provider,
      kind: schema.aiProviders.authKind,
      accountLabel: schema.aiProviders.accountLabel,
    })
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.userId, userId))
    .all();
  return rows.map((row) =>
    row.provider === "openai" && row.kind === "oauth" ? { ...row, legacy: true as const } : row,
  );
}

/** Keeps what a provider granted, in place of whatever was kept before. */
export async function storeCredential(
  env: CredentialEnv,
  key: CredentialKey,
  userId: string,
  provider: AiProviderId,
  kind: AiAuthKind,
  granted: GrantedTokens,
  now: number = Date.now(),
): Promise<void> {
  const values = {
    authKind: kind,
    accountId: granted.accountId ?? null,
    accountLabel: granted.accountLabel ?? null,
    ...(await sealed(key, granted, now)),
  };
  await db(env)
    .insert(schema.aiProviders)
    .values({ id: rowId(), userId, provider, ...values })
    .onConflictDoUpdate({
      target: [schema.aiProviders.userId, schema.aiProviders.provider],
      set: values,
    })
    .run();
}

/** Forgets the link. True when there was one. */
export async function forgetCredential(
  env: CredentialEnv,
  userId: string,
  provider: AiProviderId,
): Promise<boolean> {
  const result = await db(env)
    .delete(schema.aiProviders)
    .where(and(eq(schema.aiProviders.userId, userId), eq(schema.aiProviders.provider, provider)))
    .run();
  return result.meta.changes > 0;
}

/**
 * The credential a provider will accept as the person, renewed first when
 * it is about to expire. Throws `AiError("not_linked")` when there is none,
 * `AiError("reconnect")` when the one there was is no longer any good, and
 * `AiError("legacy")` when the row belongs to the retired OpenAI sign-in.
 */
export async function current(
  env: CredentialEnv & AiEnv,
  key: CredentialKey,
  userId: string,
  provider: AiProvider,
  fetcher: typeof fetch,
  now: number = Date.now(),
): Promise<Credential> {
  const row = await read(env, userId, provider.id);
  if (!row) throw new AiError("not_linked", `${provider.label} is not linked to this account.`);
  // The retired OpenAI device flow must never decrypt or refresh its tokens.
  // Keep the row so the account can explicitly remove it from the dashboard.
  if (isLegacyOpenAi(row)) throw legacyReconnect(provider);

  const expiresAt = row.accessExpiresAt?.getTime() ?? null;
  if (row.authKind === "api_key" || expiresAt === null || expiresAt - now > RENEW_MARGIN_MS) {
    const access = await open(key, row.accessCiphertext);
    if (access !== null) return held(access, row);
    // Encrypted under a key this gateway no longer has: gone for good.
    await forget(env, row);
    throw reconnect(provider);
  }

  // One renewal per isolate at a time: a second request that finds the same
  // token about to expire waits for the first rather than spending the
  // refresh token too. Another isolate still can, which the write below covers.
  const inflight = `${userId}:${provider.id}`;
  const pending = renewals.get(inflight);
  if (pending) return pending;
  const renewal = renew(env, key, userId, provider, fetcher, now, row).finally(() =>
    renewals.delete(inflight),
  );
  renewals.set(inflight, renewal);
  return renewal;
}

/** Renewals underway, by account and provider. */
const renewals = new Map<string, Promise<Credential>>();

async function renew(
  env: CredentialEnv & AiEnv,
  key: CredentialKey,
  userId: string,
  provider: AiProvider,
  fetcher: typeof fetch,
  now: number,
  row: AiProviderRow,
): Promise<Credential> {
  if (isLegacyOpenAi(row)) throw legacyReconnect(provider);
  const refreshToken = row.refreshCiphertext ? await open(key, row.refreshCiphertext) : null;
  if (refreshToken === null) {
    await forget(env, row);
    throw reconnect(provider);
  }
  if (!provider.refresh) throw reconnect(provider);
  let granted: GrantedTokens;
  try {
    granted = await provider.refresh(fetcher, env, refreshToken);
  } catch (error) {
    if (!(error instanceof AiError) || error.kind !== "reconnect") throw error;
    // The slower of two renewals: what the faster one stored is the credential.
    const latest = await read(env, userId, provider.id);
    if (latest && latest.accessCiphertext !== row.accessCiphertext) {
      const access = await open(key, latest.accessCiphertext);
      if (access !== null) return held(access, latest);
    }
    await forget(env, row);
    throw error;
  }

  const values = await sealed(key, granted, now);
  const written = await db(env)
    .update(schema.aiProviders)
    .set({
      ...values,
      ...(granted.accountId ? { accountId: granted.accountId } : {}),
      ...(granted.accountLabel ? { accountLabel: granted.accountLabel } : {}),
    })
    .where(
      and(
        eq(schema.aiProviders.id, row.id),
        eq(schema.aiProviders.accessCiphertext, row.accessCiphertext),
      ),
    )
    .run();
  if (written.meta.changes === 0) {
    const latest = await read(env, userId, provider.id);
    const access = latest ? await open(key, latest.accessCiphertext) : null;
    if (latest && access !== null) return held(access, latest);
    throw reconnect(provider);
  }
  return held(granted.access, { ...row, accountId: granted.accountId ?? row.accountId });
}

/** Prefixed like every other id, without widening `ids.ts` for a row nothing else names. */
function rowId(): string {
  return `aip_${crypto.randomUUID().replaceAll("-", "")}`;
}

function held(access: string, row: Pick<AiProviderRow, "authKind" | "accountId">): Credential {
  return { kind: row.authKind, access, accountId: row.accountId ?? undefined };
}

function reconnect(provider: AiProvider): AiError {
  return new AiError(
    "reconnect",
    `${provider.label} no longer accepts this account's authorization. Link it again from the settings.`,
  );
}

function legacyReconnect(provider: AiProvider): AiError {
  return new AiError(
    "legacy",
    `${provider.label} no longer supports this old ChatGPT sign-in. Use an OpenAI API key or sign in with ChatGPT on your machine.`,
  );
}

function isLegacyOpenAi(row: Pick<AiProviderRow, "provider" | "authKind">): boolean {
  return row.provider === "openai" && row.authKind === "oauth";
}

async function read(env: CredentialEnv, userId: string, provider: AiProviderId) {
  return db(env)
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.userId, userId), eq(schema.aiProviders.provider, provider)))
    .get();
}

/** Forgets the credential, as long as it is still the one that was found wanting. */
async function forget(env: CredentialEnv, row: Pick<AiProviderRow, "id" | "accessCiphertext">) {
  await db(env)
    .delete(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.id, row.id),
        eq(schema.aiProviders.accessCiphertext, row.accessCiphertext),
      ),
    )
    .run();
}

async function sealed(key: CredentialKey, granted: GrantedTokens, now: number) {
  return {
    accessCiphertext: await encryptSecret(key.credentialsKey, granted.access),
    accessExpiresAt: granted.expiresAt === undefined ? null : new Date(granted.expiresAt),
    refreshCiphertext: granted.refresh
      ? await encryptSecret(key.credentialsKey, granted.refresh)
      : null,
    updatedAt: new Date(now),
  };
}

async function open(key: CredentialKey, ciphertext: string): Promise<string | null> {
  try {
    return await decryptSecret(key.credentialsKey, ciphertext);
  } catch {
    return null;
  }
}

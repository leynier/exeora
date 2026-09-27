import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import {
  expectOk,
  type GitHubConfig,
  type GitHubEnv,
  GitHubError,
  GitHubReconnectError,
  githubConfig,
  githubFetch,
  githubHeaders,
} from "./app.js";

/**
 * The token that speaks to GitHub as the person who connected.
 *
 * An installation token answers for the installation: every repository an
 * organisation gave the app, whoever is asking. What one member of that
 * organisation may see is a question only their own token can put, so it is
 * kept, encrypted, and every list, link and credential is checked with it.
 *
 * GitHub issues it for eight hours with a refresh token that is good once.
 * Renewing it replaces both, and both are written back together.
 */

export type UserTokenEnv = GitHubEnv & Pick<Env, "DB">;

/** What GitHub grants for a code or for a refresh token. */
export interface GrantedTokens {
  accessToken: string;
  /** Seconds the access token lives, or null for one that does not expire. */
  expiresIn: number | null;
  refreshToken: string | null;
}

export const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
/** Renewed this long before it expires, so a request that starts now can finish. */
const RENEW_MARGIN_MS = 5 * 60_000;

/** Reads a grant out of GitHub's answer, or null for an answer that refuses one. */
export function parseGrant(body: unknown): GrantedTokens | null {
  if (body === null || typeof body !== "object") return null;
  const raw = body as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
  if (typeof raw.access_token !== "string" || raw.access_token === "") return null;
  return {
    accessToken: raw.access_token,
    expiresIn: typeof raw.expires_in === "number" && raw.expires_in > 0 ? raw.expires_in : null,
    refreshToken:
      typeof raw.refresh_token === "string" && raw.refresh_token !== "" ? raw.refresh_token : null,
  };
}

/** The person on GitHub, as GitHub names them. */
export interface GitHubPerson {
  login: string;
  /** GitHub's id for them, which outlasts a change of login. */
  id: number | null;
}

/** Keeps what a connection was granted, in place of whatever was kept before. */
export async function storeUserTokens(
  env: Pick<Env, "DB">,
  config: Pick<GitHubConfig, "credentialsKey">,
  userId: string,
  person: GitHubPerson,
  granted: GrantedTokens,
  now: number = Date.now(),
): Promise<void> {
  const values = {
    login: person.login,
    githubUserId: person.id,
    ...(await sealed(config, granted, now)),
  };
  await db(env)
    .insert(schema.githubUserTokens)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.githubUserTokens.userId, set: values })
    .run();
}

/** Whether the account has a token at all. Says nothing of whether GitHub still takes it. */
export async function hasUserToken(env: Pick<Env, "DB">, userId: string): Promise<boolean> {
  const row = await db(env)
    .select({ access: schema.githubUserTokens.accessCiphertext })
    .from(schema.githubUserTokens)
    .where(eq(schema.githubUserTokens.userId, userId))
    .get();
  return Boolean(row?.access);
}

/**
 * A token GitHub will accept as the person, renewed first when it is about
 * to expire. Throws `GitHubReconnectError` when there is none to be had.
 */
export async function userAccessToken(
  env: UserTokenEnv,
  userId: string,
  fetcher: typeof fetch,
  now: number = Date.now(),
): Promise<string> {
  return (await current(env, userId, fetcher, now)).token;
}

/**
 * A request to GitHub as the person. A token GitHub refuses outright was
 * revoked there, and is forgotten here, so the account is told to connect
 * again instead of failing the same way on every request.
 */
export async function userFetch(
  env: UserTokenEnv,
  userId: string,
  url: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const { token, sealedAccess } = await current(env, userId, fetcher, Date.now());
  const response = await githubFetch(fetcher, url, { headers: githubHeaders(`Bearer ${token}`) });
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    await forget(env, userId, { access: sealedAccess });
    throw new GitHubReconnectError();
  }
  return response;
}

interface Current {
  token: string;
  /** The stored form of `token`, which is how a later write knows it is still the one. */
  sealedAccess: string;
}

async function current(
  env: UserTokenEnv,
  userId: string,
  fetcher: typeof fetch,
  now: number,
): Promise<Current> {
  const config = githubConfig(env);
  if (!config) throw new GitHubReconnectError();
  const row = await read(env, userId);
  if (!row?.accessCiphertext) throw new GitHubReconnectError();

  const expiresAt = row.accessExpiresAt?.getTime() ?? null;
  if (expiresAt === null || expiresAt - now > RENEW_MARGIN_MS) {
    const token = await open(config, row.accessCiphertext);
    if (token !== null) return { token, sealedAccess: row.accessCiphertext };
    // Encrypted under a key this gateway no longer has: gone for good.
    await forget(env, userId, { access: row.accessCiphertext });
    throw new GitHubReconnectError();
  }

  const refreshToken = row.refreshCiphertext ? await open(config, row.refreshCiphertext) : null;
  if (refreshToken === null) {
    await forget(env, userId, { access: row.accessCiphertext });
    throw new GitHubReconnectError();
  }
  const granted = await refresh(config, refreshToken, fetcher);
  if (granted === null) {
    // A refresh token is good once. Two requests that both found the token
    // about to expire both try, and the slower one is refused: what the
    // faster one stored is then the token to use, not a reason to disconnect.
    const latest = await read(env, userId);
    if (latest?.accessCiphertext && latest.accessCiphertext !== row.accessCiphertext) {
      const token = await open(config, latest.accessCiphertext);
      if (token !== null) return { token, sealedAccess: latest.accessCiphertext };
    }
    await forget(env, userId, { access: row.accessCiphertext });
    throw new GitHubReconnectError();
  }

  const values = await sealed(config, granted, now);
  // Only over the pair that was read, for the same reason as above.
  const written = await db(env)
    .update(schema.githubUserTokens)
    .set(values)
    .where(
      and(
        eq(schema.githubUserTokens.userId, userId),
        eq(schema.githubUserTokens.accessCiphertext, row.accessCiphertext),
      ),
    )
    .run();
  if (written.meta.changes === 0) {
    const latest = await read(env, userId);
    const token = latest?.accessCiphertext ? await open(config, latest.accessCiphertext) : null;
    if (latest?.accessCiphertext && token !== null) {
      return { token, sealedAccess: latest.accessCiphertext };
    }
    throw new GitHubReconnectError();
  }
  return { token: granted.accessToken, sealedAccess: values.accessCiphertext };
}

/** Null when GitHub refuses the refresh token itself, which no retry will change. */
async function refresh(
  config: GitHubConfig,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<GrantedTokens | null> {
  const response = await githubFetch(fetcher, TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": "exeora-gateway",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  await expectOk(response);
  // A refusal is answered 200 with an `error` in the body.
  const body = (await response.json()) as { error?: unknown };
  if (body.error === "incorrect_client_credentials") {
    // The gateway's own secret is wrong, which is nothing the person did and
    // nothing connecting again would mend.
    throw new GitHubError(
      401,
      "GitHub refused the credentials of this gateway's app. Whoever runs the gateway has to check the app's client id and secret.",
    );
  }
  return parseGrant(body);
}

/**
 * Forgets the token of every account connected as a person who took their
 * authorization back on GitHub, and answers with those accounts. Matched on
 * GitHub's id for the person; on the login only for a row kept before the id
 * was, since a login that was given up can be somebody else's by now.
 */
export async function forgetGitHubPerson(
  env: Pick<Env, "DB">,
  person: GitHubPerson,
): Promise<string[]> {
  const rows = await db(env)
    .select({
      userId: schema.githubUserTokens.userId,
      login: schema.githubUserTokens.login,
      githubUserId: schema.githubUserTokens.githubUserId,
    })
    .from(schema.githubUserTokens)
    .all();
  const login = person.login.toLowerCase();
  const theirs = rows
    .filter((row) =>
      row.githubUserId === null
        ? login !== "" && row.login.toLowerCase() === login
        : row.githubUserId === person.id,
    )
    .map((row) => row.userId);
  for (const userId of theirs) {
    await db(env)
      .update(schema.githubUserTokens)
      .set({
        accessCiphertext: null,
        accessExpiresAt: null,
        refreshCiphertext: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.githubUserTokens.userId, userId))
      .run();
  }
  return theirs;
}

async function read(env: Pick<Env, "DB">, userId: string) {
  return db(env)
    .select()
    .from(schema.githubUserTokens)
    .where(eq(schema.githubUserTokens.userId, userId))
    .get();
}

/** Forgets the tokens, as long as they are still the ones that were found wanting. */
async function forget(
  env: Pick<Env, "DB">,
  userId: string,
  found: { access: string },
): Promise<void> {
  await db(env)
    .update(schema.githubUserTokens)
    .set({
      accessCiphertext: null,
      accessExpiresAt: null,
      refreshCiphertext: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.githubUserTokens.userId, userId),
        eq(schema.githubUserTokens.accessCiphertext, found.access),
      ),
    )
    .run();
}

async function sealed(
  config: Pick<GitHubConfig, "credentialsKey">,
  granted: GrantedTokens,
  now: number,
) {
  return {
    accessCiphertext: await encryptSecret(config.credentialsKey, granted.accessToken),
    accessExpiresAt: granted.expiresIn === null ? null : new Date(now + granted.expiresIn * 1000),
    refreshCiphertext: granted.refreshToken
      ? await encryptSecret(config.credentialsKey, granted.refreshToken)
      : null,
    updatedAt: new Date(now),
  };
}

async function open(
  config: Pick<GitHubConfig, "credentialsKey">,
  ciphertext: string,
): Promise<string | null> {
  try {
    return await decryptSecret(config.credentialsKey, ciphertext);
  } catch {
    return null;
  }
}

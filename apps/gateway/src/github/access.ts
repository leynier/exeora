import "../env.js";
import { GITHUB_API, GitHubError } from "./app.js";
import { type UserTokenEnv, userFetch } from "./user-token.js";

/**
 * What one person may do with one repository, as GitHub says it to them.
 *
 * Asked with their own token, because that is the only question whose answer
 * is about them. Kept for ten minutes, since git asks for a credential on
 * every fetch and push and each of those must not become a request to GitHub.
 */

export type AccessEnv = UserTokenEnv & Pick<Env, "OAUTH_KV">;

export interface RepositoryAccess {
  pull: boolean;
  push: boolean;
}

/** Someone who cannot see a repository can do nothing with it. */
export const NO_ACCESS: RepositoryAccess = { pull: false, push: false };

const CACHE_SECONDS = 10 * 60;

export const accessCacheKey = (userId: string, repositoryId: number) =>
  `github:access:${userId}:${repositoryId}`;

/**
 * `fresh` asks GitHub whatever is remembered. A link is made once and stands
 * until something takes it away, so it is made on what is true now.
 */
export async function repositoryAccess(
  env: AccessEnv,
  userId: string,
  repositoryId: number,
  fetcher: typeof fetch,
  options: { fresh?: boolean } = {},
): Promise<RepositoryAccess> {
  const key = accessCacheKey(userId, repositoryId);
  if (!options.fresh) {
    const cached = await env.OAUTH_KV.get<RepositoryAccess>(key, "json");
    if (cached && typeof cached.pull === "boolean" && typeof cached.push === "boolean") {
      return { pull: cached.pull, push: cached.push };
    }
  }

  const response = await userFetch(
    env,
    userId,
    `${GITHUB_API}/repositories/${repositoryId}`,
    fetcher,
  );
  const access = await read(response);
  await env.OAUTH_KV.put(key, JSON.stringify(access), { expirationTtl: CACHE_SECONDS });
  return access;
}

async function read(response: Response): Promise<RepositoryAccess> {
  if (response.ok) {
    const body = (await response.json()) as { permissions?: { pull?: unknown; push?: unknown } };
    const pull = body.permissions?.pull === true;
    return { pull, push: pull && body.permissions?.push === true };
  }
  await response.body?.cancel().catch(() => undefined);
  // GitHub answers 404 for a repository the person may not see, so that it
  // does not say the repository exists.
  if (response.status === 404) return NO_ACCESS;
  if (response.status === 403) {
    // 403 is also how GitHub says "too many requests", which is no verdict
    // on anybody's access and must not take a project's link away.
    const limited =
      response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    if (!limited) return NO_ACCESS;
  }
  throw new GitHubError(
    response.status,
    "GitHub could not say whether this account can reach the repository. Try again in a few minutes.",
  );
}

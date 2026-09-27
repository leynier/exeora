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

/**
 * What GitHub's answer says about the person, when it says anything.
 *
 * Only a definite answer is a verdict, because a verdict is remembered and
 * takes a project's link away. "Not found" is one: it is what GitHub says of
 * a repository the person may not see. 403 is one only when it says so in
 * words, since 403 is also how GitHub says "too many requests", and the
 * second kind of limit arrives with no header to tell it by. Everything else
 * is GitHub failing to answer, which is thrown, kept nowhere, and tried again.
 */
async function read(response: Response): Promise<RepositoryAccess> {
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      permissions?: { pull?: unknown; push?: unknown } | null;
    } | null;
    const permissions = body?.permissions;
    // Asked as a person, a repository always comes with what they may do. One
    // that comes without is an answer to something else.
    if (permissions && typeof permissions.pull === "boolean") {
      const pull = permissions.pull;
      return { pull, push: pull && permissions.push === true };
    }
    throw unanswered(502);
  }
  const text = await response.text().catch(() => "");
  if (response.status === 404) return NO_ACCESS;
  if (response.status === 403 && !LIMITED.test(text) && REFUSED.test(text)) {
    const limited =
      response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    if (!limited) return NO_ACCESS;
  }
  throw unanswered(response.status);
}

/** How GitHub words either of its limits, whatever headers came with it. */
const LIMITED = /rate limit|abuse detection|too many requests/i;
/** How it words a person not being let in. */
const REFUSED =
  /resource not accessible|not accessible by|must have .{0,40}access|do(es)? not have (access|permission)/i;

function unanswered(status: number): GitHubError {
  return new GitHubError(
    status,
    "GitHub could not say whether this account can reach the repository. Try again in a few minutes.",
  );
}

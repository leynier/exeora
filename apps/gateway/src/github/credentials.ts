import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { type AccessEnv, repositoryAccess } from "./access.js";
import {
  type GitHubEnv,
  GitHubError,
  type GitHubPermissions,
  githubConfig,
  installationToken,
} from "./app.js";
import { markLost } from "./links.js";

/**
 * What a machine clones and pushes with: a token for one repository, good for
 * an hour, minted when git asks for it.
 *
 * Nothing is stored, so there is nothing to rotate and nothing to leak from
 * the database. A machine that is taken away from a project simply stops
 * being answered.
 *
 * The token is the installation's, and can do whatever the installation was
 * given. It is therefore cut down to what the project's owner can do on
 * GitHub themselves: nothing for someone who can no longer read the
 * repository, and reading only for someone who may not push.
 */

export interface GitCredential {
  host: "github.com";
  username: "x-access-token";
  password: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** What an agent needs to do its work: push a branch and open the pull request for it. */
const FULL: GitHubPermissions = { contents: "write", metadata: "read", pull_requests: "write" };
/** What is left for an installation that was not given pull requests. */
const REDUCED: GitHubPermissions = { contents: "write", metadata: "read" };
/** For a person who can read the repository and not push to it. Never more. */
const READ_ONLY: GitHubPermissions = { contents: "read", metadata: "read" };

/**
 * The repository a project clones through, when it has one that still works:
 * a link that was not lost, through an installation the account still holds
 * and that is not suspended.
 */
async function linkOf(env: Pick<Env, "DB">, projectId: string, userId?: string) {
  return db(env)
    .select({
      userId: schema.githubRepositories.userId,
      installationId: schema.githubRepositories.installationId,
      repoId: schema.githubRepositories.repoId,
    })
    .from(schema.githubRepositories)
    .innerJoin(
      schema.githubInstallations,
      and(
        eq(schema.githubInstallations.userId, schema.githubRepositories.userId),
        eq(schema.githubInstallations.installationId, schema.githubRepositories.installationId),
      ),
    )
    .where(
      and(
        eq(schema.githubRepositories.projectId, projectId),
        isNull(schema.githubRepositories.lostAccessAt),
        isNull(schema.githubInstallations.suspendedAt),
        ...(userId === undefined ? [] : [eq(schema.githubRepositories.userId, userId)]),
      ),
    )
    .get();
}

/**
 * Whether `projectCredential` would have something to answer with. One read
 * of the database and no request to GitHub, so it can be asked on the way to
 * every clone.
 */
export async function hasProjectCredential(
  env: GitHubEnv & Pick<Env, "DB">,
  projectId: string,
): Promise<boolean> {
  if (!githubConfig(env)) return false;
  return (await linkOf(env, projectId)) !== undefined;
}

/**
 * The credential for a project's repository, or null for a project that is
 * not connected, or whose owner GitHub no longer lets read the repository.
 */
export async function projectCredential(
  env: AccessEnv,
  userId: string,
  projectId: string,
  fetcher: typeof fetch,
): Promise<GitCredential | null> {
  const config = githubConfig(env);
  if (!config) return null;
  const link = await linkOf(env, projectId, userId);
  if (!link) return null;

  const access = await repositoryAccess(env, userId, link.repoId, fetcher);
  if (!access.pull) {
    // Written down, so the dashboard says why and the next request does not
    // have to find out again.
    await markLost(env, projectId);
    return null;
  }

  const mint = (permissions: GitHubPermissions) =>
    installationToken(
      config,
      link.installationId,
      { repositoryIds: [link.repoId], permissions },
      fetcher,
    );
  let minted: Awaited<ReturnType<typeof mint>>;
  if (!access.push) {
    minted = await mint(READ_ONLY);
  } else {
    try {
      minted = await mint(FULL);
    } catch (error) {
      // 422 is GitHub refusing a permission the installation never granted.
      // Cloning and pushing still work without pull requests, so that much
      // is asked for once more before giving up.
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
      minted = await mint(REDUCED);
    }
  }
  return {
    host: "github.com",
    username: "x-access-token",
    password: minted.token,
    expiresAt: minted.expiresAt,
  };
}

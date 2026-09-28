import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { type AccessEnv, repositoryAccess } from "./access.js";
import {
  type GitHubEnv,
  GitHubError,
  type GitHubPermissions,
  githubConfig,
  type InstallationToken,
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

/**
 * What an agent needs of git to do its work: push a branch, open the pull
 * request for it, and have the push accepted when it changes a file under
 * `.github/workflows/`, which GitHub refuses without `workflows`.
 *
 * Nothing else of what the app asks for is here. This is the token git holds,
 * and git has no use for issues or checks.
 */
const FULL: GitHubPermissions = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
  workflows: "write",
};
/** For an installation whose owner has not accepted `workflows` yet. */
const LEGACY_FULL: GitHubPermissions = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
};
/** What is left for an installation that was not given pull requests. */
const REDUCED: GitHubPermissions = { contents: "write", metadata: "read" };
/** For a person who can read the repository and not push to it. Never more. */
const READ_ONLY: GitHubPermissions = { contents: "read", metadata: "read" };

/** What is asked for someone who may push, widest first. Each is asked once. */
const WRITE_CHAIN = [FULL, LEGACY_FULL, REDUCED];

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
  const minted = access.push ? await widestGranted(mint) : await mint(READ_ONLY);
  return {
    host: "github.com",
    username: "x-access-token",
    password: minted.token,
    expiresAt: minted.expiresAt,
  };
}

/**
 * The first token of the chain GitHub grants.
 *
 * 422 is GitHub refusing a permission the installation never granted, and
 * the only answer that is worth asking again with less: cloning and pushing
 * work without workflows, and without pull requests. Anything else is thrown
 * as it came, since asking for less would not mend it. The chain is a list
 * walked once, so a GitHub that refuses everything is asked three times and
 * no more.
 */
async function widestGranted(
  mint: (permissions: GitHubPermissions) => Promise<InstallationToken>,
): Promise<InstallationToken> {
  let refused: unknown;
  for (const permissions of WRITE_CHAIN) {
    try {
      return await mint(permissions);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
      refused = error;
    }
  }
  throw refused;
}

import { httpsRepositoryUrl } from "@exeora/protocol";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { type AppPermission, pendingPermissions } from "../permissions.js";

/**
 * Which repository on GitHub a project is, for the pull request screen.
 *
 * A project that was connected through the app says so in
 * `github_repositories`. One that was only ever registered from a machine
 * says it in its remote: a github.com address, https or ssh, names the
 * repository as well. Anything else is not on GitHub, and the screen says
 * so instead of asking.
 */

export interface RepositoryName {
  owner: string;
  repo: string;
  /** `owner/repo`, as GitHub writes it. */
  fullName: string;
}

const GITHUB_HTTPS = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\.git$/;

/** The repository a github.com address names, in whichever form git accepts it. */
export function parseGitHubUrl(url: string | null | undefined): RepositoryName | null {
  const https = httpsRepositoryUrl(url ?? "");
  const match = https === null ? null : GITHUB_HTTPS.exec(https);
  if (!match?.[1] || !match[2]) return null;
  return named(match[1], match[2]);
}

function named(owner: string, repo: string): RepositoryName {
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function fromFullName(fullName: string): RepositoryName | null {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return named(owner, repo);
}

/**
 * The repository of the account's project, or null for one that is not on
 * GitHub. The link is believed over the remote while the app still reaches
 * the repository; a link whose access was lost falls back to the remote,
 * which is where git on the machine still pushes.
 */
export async function repositoryOf(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
): Promise<RepositoryName | null> {
  const row = await db(env)
    .select({
      repoUrl: schema.projects.repoUrl,
      fullName: schema.githubRepositories.fullName,
      lostAccessAt: schema.githubRepositories.lostAccessAt,
    })
    .from(schema.projects)
    .leftJoin(
      schema.githubRepositories,
      eq(schema.githubRepositories.projectId, schema.projects.id),
    )
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!row) return null;
  if (row.fullName !== null && row.lostAccessAt === null) {
    const linked = fromFullName(row.fullName);
    if (linked) return linked;
  }
  return parseGitHubUrl(row.repoUrl);
}

export interface RepositoryInstallation {
  installationId: number;
  /** What the app asks for that this installation has not granted yet. */
  pending: AppPermission[];
}

/**
 * The account's installation on the owner of a repository, with what it
 * still owes the app. Null when the owner never installed the app for this
 * account, in which case the person's own token is all there is, and the
 * dashboard has nothing to say about permissions.
 */
export async function installationFor(
  env: Pick<Env, "DB">,
  userId: string,
  owner: string,
): Promise<RepositoryInstallation | null> {
  const row = await db(env)
    .select({
      installationId: schema.githubInstallations.installationId,
      permissions: schema.githubInstallations.permissions,
    })
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.userId, userId),
        eq(sql`lower(${schema.githubInstallations.accountLogin})`, owner.toLowerCase()),
      ),
    )
    .get();
  if (!row) return null;
  return { installationId: row.installationId, pending: pendingPermissions(row.permissions) };
}

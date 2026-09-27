import { repositoryKey } from "@exeora/protocol";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { type AccessEnv, repositoryAccess } from "./access.js";
import { githubConfig } from "./app.js";
import { reachable } from "./repositories.js";

/**
 * Which repository a project is.
 *
 * A link is what lets a machine ask for a token, so one is written only for
 * a repository the person can read on GitHub, as GitHub says it to their own
 * token. That a repository is in the installation is not enough: the
 * installation is the organisation's, and the project is one member's.
 */

/** What a link needs to know about a repository. */
export interface RepositoryLink {
  installationId: number;
  id: number;
  fullName: string;
  private: boolean;
}

/**
 * The write itself, for a repository whose access was already checked.
 * Selected out of the account's own projects, so naming somebody else's
 * project writes nothing.
 */
export function linkProjectStatement(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
  repository: RepositoryLink,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO github_repositories (project_id, user_id, installation_id, repo_id, full_name, private, lost_access_at, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7 FROM projects WHERE id = ?1 AND user_id = ?2
     ON CONFLICT (project_id) DO UPDATE SET
       installation_id = excluded.installation_id,
       repo_id = excluded.repo_id,
       full_name = excluded.full_name,
       private = excluded.private,
       lost_access_at = NULL,
       updated_at = excluded.updated_at`,
  ).bind(
    projectId,
    userId,
    repository.installationId,
    repository.id,
    repository.fullName,
    repository.private ? 1 : 0,
    Date.now(),
  );
}

/**
 * Says which repository a project is, or says it again after the access came
 * back. False, and nothing written, when the person cannot read the
 * repository or the project is not theirs.
 */
export async function linkProject(
  env: AccessEnv,
  userId: string,
  projectId: string,
  repository: RepositoryLink,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!githubConfig(env)) return false;
  const access = await repositoryAccess(env, userId, repository.id, fetcher, { fresh: true });
  if (!access.pull) return false;
  const result = await linkProjectStatement(env, userId, projectId, repository).run();
  return result.meta.changes > 0;
}

/**
 * Connects every project of the account that is a repository the person can
 * reach. Run after connecting, so a project that was added from a laptop last
 * month clones through GitHub without being made again.
 */
export async function linkByRepository(
  env: AccessEnv,
  userId: string,
  fetcher: typeof fetch,
): Promise<number> {
  if (!githubConfig(env)) return 0;
  const found = await reachable(env, userId, fetcher);
  // Listed by GitHub for the person a moment ago, which is the check itself.
  return linkMatching(
    env,
    userId,
    found.map(({ installationId, repository }) => ({ ...repository, installationId })),
    fetcher,
    { listedForUser: true },
  );
}

/**
 * The same, for repositories already in hand. The ones a webhook names were
 * added to an installation, which says nothing of who may read them, so each
 * that matches a project is asked about before it is linked.
 */
export async function linkMatching(
  env: AccessEnv,
  userId: string,
  repositories: Array<RepositoryLink & { url: string }>,
  fetcher: typeof fetch,
  options: { listedForUser: boolean },
): Promise<number> {
  if (repositories.length === 0) return 0;
  const byKey = new Map<string, RepositoryLink>();
  for (const repository of repositories) {
    const key = repositoryKey(repository.url);
    if (key && !byKey.has(key)) byKey.set(key, repository);
  }

  const rows = await db(env)
    .select({
      id: schema.projects.id,
      repoKey: schema.projects.repoKey,
      linked: schema.githubRepositories.projectId,
      lostAccessAt: schema.githubRepositories.lostAccessAt,
    })
    .from(schema.projects)
    .leftJoin(
      schema.githubRepositories,
      eq(schema.githubRepositories.projectId, schema.projects.id),
    )
    .where(and(eq(schema.projects.userId, userId), isNotNull(schema.projects.repoKey)))
    .all();

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const repository = row.repoKey ? byKey.get(row.repoKey) : undefined;
    if (!repository) continue;
    // A link that works is left as it is: it may go through another
    // installation than the one being looked at.
    if (row.linked !== null && row.lostAccessAt === null) continue;
    if (!options.listedForUser) {
      const access = await repositoryAccess(env, userId, repository.id, fetcher, { fresh: true });
      if (!access.pull) continue;
    }
    statements.push(linkProjectStatement(env, userId, row.id, repository));
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}

/** Takes the link's access away, for a person GitHub no longer lets read the repository. */
export async function markLost(env: Pick<Env, "DB">, projectId: string): Promise<void> {
  await db(env)
    .update(schema.githubRepositories)
    .set({ lostAccessAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.githubRepositories.projectId, projectId))
    .run();
}

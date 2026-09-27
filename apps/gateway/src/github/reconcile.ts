import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import {
  expectOk,
  GITHUB_API,
  type GitHubEnv,
  githubConfig,
  githubFetch,
  githubHeaders,
  installationToken,
} from "./app.js";

/**
 * Brings the links of an installation back in line with what it holds.
 *
 * GitHub names the repositories that leave an installation, except the one
 * time it matters most: an installation switched from every repository to a
 * chosen few is announced with an empty list. What left is then everything
 * that is not there any more, and the only way to know what is there is to
 * ask.
 */

/** Five thousand repositories. An installation with more is left as it is. */
const MAX_PAGES = 50;

/**
 * Marks as lost every link of the installation to a repository it no longer
 * holds, and answers with how many. Throws when GitHub cannot be asked: a
 * list that is not known to be whole takes nothing away.
 */
export async function reconcileInstallation(
  env: GitHubEnv & Pick<Env, "DB">,
  installationId: number,
  fetcher: typeof fetch,
): Promise<number> {
  const config = githubConfig(env);
  if (!config) return 0;
  const linked = await db(env)
    .select({
      projectId: schema.githubRepositories.projectId,
      repoId: schema.githubRepositories.repoId,
    })
    .from(schema.githubRepositories)
    .where(
      and(
        eq(schema.githubRepositories.installationId, installationId),
        isNull(schema.githubRepositories.lostAccessAt),
      ),
    )
    .all();
  if (linked.length === 0) return 0;

  const { token } = await installationToken(
    config,
    installationId,
    { permissions: { metadata: "read" } },
    fetcher,
  );
  const held = new Set<number>();
  let whole = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await githubFetch(
      fetcher,
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      { headers: githubHeaders(`Bearer ${token}`) },
    );
    await expectOk(response);
    const body = (await response.json()) as { repositories?: Array<{ id?: unknown }> };
    const batch = Array.isArray(body.repositories) ? body.repositories : [];
    for (const repository of batch) {
      if (typeof repository.id === "number") held.add(repository.id);
    }
    if (batch.length < 100) {
      whole = true;
      break;
    }
  }
  // Cut short, the list would make every repository past its end look gone.
  if (!whole) return 0;

  const gone = linked.filter((link) => !held.has(link.repoId));
  if (gone.length === 0) return 0;
  const now = Date.now();
  await env.DB.batch(
    gone.map((link) =>
      env.DB.prepare(
        `UPDATE github_repositories SET lost_access_at = ?2, updated_at = ?2
          WHERE project_id = ?1 AND installation_id = ?3 AND lost_access_at IS NULL`,
      ).bind(link.projectId, now, installationId),
    ),
  );
  return gone.length;
}

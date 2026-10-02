import { repositoryKey } from "@exeora/protocol";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { type AccessEnv, repositoryAccess } from "./access.js";
import {
  expectOk,
  GITHUB_API,
  GitHubError,
  GitHubReconnectError,
  githubConfig,
  githubFetch,
  githubHeaders,
  installationToken,
} from "./app.js";
import { userFetch } from "./user-token.js";

/**
 * The repositories an account can pick from, and which of them are already
 * its projects.
 *
 * What an installation holds and what a person may reach are different
 * lists: an organisation gives the app forty repositories, and one of its
 * members can see six. The list here is the second, asked of GitHub with the
 * person's own token, and kept for a minute: a picker filters as somebody
 * types, and each keystroke must not be a walk through every page.
 */

export type RepositoriesEnv = AccessEnv;

/** A repository as GitHub describes it, reduced to what is shown and cloned. */
export interface InstallationRepository {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** The https clone address, ending in `.git`. */
  url: string;
  description: string | null;
  /** Milliseconds since the epoch, or null for a repository nothing was pushed to. */
  pushedAt: number | null;
  /** Whether the person may push, which decides what a machine's token may do. */
  canPush: boolean;
}

export interface RepositoryView extends InstallationRepository {
  owner: string;
  name: string;
  installationId: number;
  /** The account's project that is this repository, when it has one. */
  projectId: string | null;
}

export interface Reachable {
  installationId: number;
  repository: InstallationRepository;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** A thousand repositories per installation. Past that the picker asks for a search. */
const MAX_PAGES = 10;
/** The shortest a KV entry can live, and long enough for one sitting at the picker. */
const CACHE_SECONDS = 60;

/** By account as well as installation: two members of one organisation see different lists. */
export const repositoriesCacheKey = (userId: string, installationId: number) =>
  `github:repos:${userId}:${installationId}`;

export async function listRepositories(
  env: RepositoriesEnv,
  userId: string,
  options: { query?: string | undefined; limit?: number | undefined },
  fetcher: typeof fetch,
): Promise<RepositoryView[]> {
  if (!githubConfig(env)) return [];

  const found = await reachable(env, userId, fetcher);
  const projects = await projectsByKey(env, userId);
  const needle = options.query?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  return found
    .filter(({ repository }) => repository.fullName.toLowerCase().includes(needle))
    .sort((a, b) => (b.repository.pushedAt ?? 0) - (a.repository.pushedAt ?? 0))
    .slice(0, limit)
    .map(({ installationId, repository }) => {
      const [owner = "", name = ""] = repository.fullName.split("/");
      const key = repositoryKey(repository.url);
      return {
        ...repository,
        owner,
        name,
        installationId,
        projectId: (key ? projects.get(key) : undefined) ?? null,
      };
    });
}

/**
 * One repository the account picked, read from GitHub rather than believed.
 *
 * Three things have to hold, and each is asked of whoever knows. The
 * installation is one of the account's own, which the database says. The
 * person may read the repository, which GitHub says to their token. And the
 * installation holds it, which GitHub says by minting a token for that
 * repository alone. Null when the first or the second does not.
 */
export async function pickedRepository(
  env: RepositoriesEnv,
  userId: string,
  picked: { repositoryId: number; installationId: number },
  fetcher: typeof fetch,
): Promise<(InstallationRepository & { name: string; installationId: number }) | null> {
  const config = githubConfig(env);
  if (!config) return null;
  const installation = await db(env)
    .select({ id: schema.githubInstallations.id })
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.userId, userId),
        eq(schema.githubInstallations.installationId, picked.installationId),
        isNull(schema.githubInstallations.suspendedAt),
      ),
    )
    .get();
  if (!installation) return null;

  // Before any token is minted in the installation's name: somebody who
  // cannot see the repository learns nothing about it from here.
  const access = await repositoryAccess(env, userId, picked.repositoryId, fetcher, {
    fresh: true,
  });
  if (!access.pull) return null;

  const { token } = await installationToken(
    config,
    picked.installationId,
    { repositoryIds: [picked.repositoryId], permissions: { metadata: "read" } },
    fetcher,
  );
  const response = await githubFetch(fetcher, `${GITHUB_API}/repositories/${picked.repositoryId}`, {
    headers: githubHeaders(`Bearer ${token}`),
  });
  await expectOk(response);
  const repository = parse((await response.json()) as RawRepository);
  if (!repository || repository.id !== picked.repositoryId) {
    throw new GitHubError(502, "GitHub answered with something that is not that repository.");
  }
  const name = repository.fullName.split("/")[1] ?? repository.fullName;
  return { ...repository, canPush: access.push, name, installationId: picked.installationId };
}

/**
 * Every repository the person can reach, through every installation the
 * account holds that is not suspended.
 */
export async function reachable(
  env: RepositoriesEnv,
  userId: string,
  fetcher: typeof fetch,
): Promise<Reachable[]> {
  const installations = await db(env)
    .select({ installationId: schema.githubInstallations.installationId })
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.userId, userId),
        isNull(schema.githubInstallations.suspendedAt),
      ),
    )
    .all();

  const found: Reachable[] = [];
  let refused: GitHubError | undefined;
  for (const { installationId } of installations) {
    try {
      const repositories = await userRepositories(env, userId, installationId, fetcher);
      for (const repository of repositories) found.push({ installationId, repository });
    } catch (error) {
      // An authorization that is gone is gone for every installation.
      if (error instanceof GitHubReconnectError) throw error;
      if (!(error instanceof GitHubError)) throw error;
      // One installation that was removed must not hide the others.
      refused = error;
    }
  }
  if (refused && found.length === 0) throw refused;
  return found;
}

interface RawRepository {
  id?: unknown;
  full_name?: unknown;
  private?: unknown;
  default_branch?: unknown;
  clone_url?: unknown;
  description?: unknown;
  pushed_at?: unknown;
  permissions?: { pull?: unknown; push?: unknown } | null;
}

/** What GitHub lists for the person in one installation: never more than they can open. */
async function userRepositories(
  env: RepositoriesEnv,
  userId: string,
  installationId: number,
  fetcher: typeof fetch,
): Promise<InstallationRepository[]> {
  const key = repositoriesCacheKey(userId, installationId);
  const cached = await env.OAUTH_KV.get<InstallationRepository[]>(key, "json");
  if (Array.isArray(cached)) return cached;

  const repositories: InstallationRepository[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await userFetch(
      env,
      userId,
      `${GITHUB_API}/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      fetcher,
    );
    await expectOk(response);
    const body = await response.json().catch(() => null);
    if (!isRecord(body) || !Array.isArray(body.repositories)) {
      throw new GitHubError(
        502,
        "GitHub returned an incomplete repository list. Try again in a few minutes.",
      );
    }
    const batch = body.repositories;
    for (const raw of batch) {
      if (!isRecord(raw)) {
        throw new GitHubError(
          502,
          "GitHub returned an incomplete repository list. Try again in a few minutes.",
        );
      }
      const candidate = raw as RawRepository;
      const repository = parse(candidate);
      // Listed and yet not readable does not happen, and is not trusted if it does.
      if (!repository) {
        throw new GitHubError(
          502,
          "GitHub returned an incomplete repository list. Try again in a few minutes.",
        );
      }
      if (candidate.permissions?.pull !== false) repositories.push(repository);
    }
    if (batch.length < 100) {
      complete = true;
      break;
    }
  }

  // A full final page means the list may continue past the safety cap. Do not
  // cache or present a partial list as if it were complete.
  if (!complete) {
    throw new GitHubError(
      502,
      "GitHub returned too many repositories to verify this connection. Try again in a few minutes.",
    );
  }

  await env.OAUTH_KV.put(key, JSON.stringify(repositories), { expirationTtl: CACHE_SECONDS });
  return repositories;
}

function parse(raw: RawRepository): InstallationRepository | null {
  if (!safeRepositoryId(raw.id) || typeof raw.full_name !== "string" || raw.full_name === "") {
    return null;
  }
  const pushedAt = typeof raw.pushed_at === "string" ? Date.parse(raw.pushed_at) : Number.NaN;
  return {
    id: raw.id,
    fullName: raw.full_name,
    private: raw.private === true,
    defaultBranch: typeof raw.default_branch === "string" ? raw.default_branch : "main",
    url: typeof raw.clone_url === "string" ? raw.clone_url : cloneUrl(raw.full_name),
    description: typeof raw.description === "string" ? raw.description : null,
    pushedAt: Number.isNaN(pushedAt) ? null : pushedAt,
    canPush: raw.permissions?.push === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function safeRepositoryId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function cloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`;
}

/** A repository's name as a project slug: lowercase letters, digits and hyphens. */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "project";
}

/** The account's projects by repository, the oldest winning where two are the same one. */
async function projectsByKey(env: Pick<Env, "DB">, userId: string): Promise<Map<string, string>> {
  const rows = await db(env)
    .select({ id: schema.projects.id, repoKey: schema.projects.repoKey })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), isNotNull(schema.projects.repoKey)))
    .orderBy(schema.projects.createdAt)
    .all();
  const byKey = new Map<string, string>();
  for (const row of rows) {
    if (row.repoKey && !byKey.has(row.repoKey)) byKey.set(row.repoKey, row.id);
  }
  return byKey;
}

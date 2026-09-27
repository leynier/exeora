import { repositoryKey } from "@exeora/protocol";
import { eq, inArray } from "drizzle-orm";
import { previousUrls } from "../cloud/repository.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { type AccessEnv, accessCacheKey } from "./access.js";
import { linkMatching } from "./links.js";
import { storedPermissions } from "./permissions.js";
import { reconcileInstallation } from "./reconcile.js";
import { cloneUrl, repositoriesCacheKey } from "./repositories.js";
import { forgetGitHubPerson } from "./user-token.js";

/**
 * What GitHub tells the gateway as it happens: an installation removed or
 * suspended, or given the permissions the app started asking for, a
 * repository taken out of one, renamed, moved or deleted, a person taking
 * their authorization back.
 *
 * Without these the gateway would learn of each the hard way, as a clone that
 * fails. With them the project says it lost access before anybody tries.
 *
 * A delivery is believed for its signature and nothing else. The address is
 * public and the body names installations and repositories by number, so an
 * unsigned one would be a way to cut any account off from its repositories.
 */

export type WebhookEnv = AccessEnv;

/**
 * Whether `header` is the HMAC of `body` under the webhook secret, in the
 * `sha256=<hex>` form GitHub sends it.
 */
export async function verifySignature(
  secret: string,
  body: ArrayBuffer,
  header: string | undefined,
): Promise<boolean> {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!match?.[1] || secret === "") return false;
  const offered = new Uint8Array(32);
  for (let i = 0; i < 32; i++) offered[i] = Number.parseInt(match[1].slice(i * 2, i * 2 + 2), 16);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // `verify` compares in constant time, so a wrong signature says nothing
  // about how much of it was right.
  return crypto.subtle.verify("HMAC", key, offered, body);
}

interface Payload {
  action?: unknown;
  installation?: { id?: unknown; permissions?: unknown } | null;
  repository?: { id?: unknown; full_name?: unknown; private?: unknown } | null;
  repository_selection?: unknown;
  repositories_added?: unknown;
  repositories_removed?: unknown;
  sender?: { id?: unknown; login?: unknown } | null;
}

interface NamedRepository {
  id: number;
  fullName: string;
  private: boolean;
}

/**
 * Acts on a delivery whose signature was checked. False for one that asks
 * for nothing. The fetcher is for the events that have to ask GitHub
 * something: whether a person may read a repository that was just added,
 * and what an installation still holds once some of it was taken away.
 * Throws a `GitHubError` when that could not be asked.
 */
export async function handleWebhook(
  env: WebhookEnv,
  event: string,
  payload: unknown,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (payload === null || typeof payload !== "object") return false;
  const body = payload as Payload;
  const action = typeof body.action === "string" ? body.action : "";
  const installationId = id(body.installation?.id);

  // Read first: an installation that is deleted has no holders afterwards.
  const holders = installationId === null ? [] : await holdersOf(env, installationId);
  const handled = await dispatch(env, event, action, installationId, body, holders, fetcher);
  // Whatever changed, the lists kept for the picker may now be wrong.
  if (handled && installationId !== null) {
    for (const userId of holders) {
      await env.OAUTH_KV.delete(repositoriesCacheKey(userId, installationId)).catch(
        () => undefined,
      );
    }
  }
  return handled;
}

/** Every account that holds an installation: an organisation's is held by each member who connected. */
async function holdersOf(env: WebhookEnv, installationId: number): Promise<string[]> {
  const rows = await db(env)
    .select({ userId: schema.githubInstallations.userId })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId))
    .all();
  return rows.map((row) => row.userId);
}

async function dispatch(
  env: WebhookEnv,
  event: string,
  action: string,
  installationId: number | null,
  body: Payload,
  holders: string[],
  fetcher: typeof fetch,
): Promise<boolean> {
  if (event === "installation" && installationId !== null) {
    if (action === "deleted") return installationDeleted(env, installationId);
    if (action === "suspend") return suspended(env, installationId, new Date());
    if (action === "unsuspend") return suspended(env, installationId, null);
    if (action === "new_permissions_accepted") {
      return permissionsAccepted(env, installationId, body.installation?.permissions);
    }
    return false;
  }
  if (event === "github_app_authorization") {
    return action === "revoked" ? authorizationRevoked(env, body) : false;
  }
  if (event === "installation_repositories" && installationId !== null) {
    if (action === "removed") {
      return repositoriesRemoved(env, installationId, body, fetcher);
    }
    if (action === "added") {
      return repositoriesAdded(env, installationId, body, holders, fetcher);
    }
    return false;
  }
  if (event === "repository") {
    const repository = named(body.repository);
    if (!repository) return false;
    if (action === "renamed" || action === "transferred") return renamed(env, repository);
    if (action === "privatized" || action === "publicized") return visibility(env, repository);
    if (action === "deleted") return lost(env, [repository.id]);
  }
  return false;
}

async function installationDeleted(env: WebhookEnv, installationId: number): Promise<boolean> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM github_installations WHERE installation_id = ?1").bind(
      installationId,
    ),
    env.DB.prepare(
      `UPDATE github_repositories SET lost_access_at = ?2, updated_at = ?2
        WHERE installation_id = ?1 AND lost_access_at IS NULL`,
    ).bind(installationId, now),
  ]);
  return true;
}

async function suspended(env: WebhookEnv, installationId: number, at: Date | null) {
  await db(env)
    .update(schema.githubInstallations)
    .set({ suspendedAt: at, updatedAt: new Date() })
    .where(eq(schema.githubInstallations.installationId, installationId))
    .run();
  return true;
}

/**
 * The owner of an installation said yes to what the app started asking for.
 * The installation is one and the accounts that hold it are many, so what it
 * grants now is written on the row of each.
 */
async function permissionsAccepted(env: WebhookEnv, installationId: number, granted: unknown) {
  const permissions = storedPermissions(granted);
  // A delivery that does not say what was accepted changes nothing.
  if (permissions === null) return false;
  await db(env)
    .update(schema.githubInstallations)
    .set({ permissions, updatedAt: new Date() })
    .where(eq(schema.githubInstallations.installationId, installationId))
    .run();
  return true;
}

async function repositoriesRemoved(
  env: WebhookEnv,
  installationId: number,
  body: Payload,
  fetcher: typeof fetch,
) {
  await selectionChanged(env, installationId, body);
  const removed = list(body.repositories_removed).map((repository) => repository.id);
  if (removed.length > 0) await lost(env, removed, installationId);
  // An installation cut down from every repository to a chosen few says so
  // with an empty list. What it names is believed, and what it holds now is
  // asked, whenever the list could be less than the whole of what left.
  if (removed.length === 0 || body.repository_selection === "selected") {
    await reconcileInstallation(env, installationId, fetcher);
  }
  return true;
}

/**
 * The person took their authorization back on GitHub. Their token is
 * worthless from that moment, and is forgotten now rather than at the next
 * request it fails, so the account is told to connect again straight away.
 * What was remembered about their access goes with it: it was true of
 * somebody GitHub no longer answers for.
 */
async function authorizationRevoked(env: WebhookEnv, body: Payload): Promise<boolean> {
  const login = typeof body.sender?.login === "string" ? body.sender.login : "";
  const person = { login, id: id(body.sender?.id) };
  if (person.id === null && login === "") return false;

  const accounts = await forgetGitHubPerson(env, person);
  if (accounts.length === 0) return true;
  const links = await db(env)
    .select({
      userId: schema.githubRepositories.userId,
      repoId: schema.githubRepositories.repoId,
    })
    .from(schema.githubRepositories)
    .where(inArray(schema.githubRepositories.userId, accounts))
    .all();
  const held = await db(env)
    .select({
      userId: schema.githubInstallations.userId,
      installationId: schema.githubInstallations.installationId,
    })
    .from(schema.githubInstallations)
    .where(inArray(schema.githubInstallations.userId, accounts))
    .all();
  const keys = [
    ...links.map((link) => accessCacheKey(link.userId, link.repoId)),
    ...held.map((row) => repositoriesCacheKey(row.userId, row.installationId)),
  ];
  for (const key of keys) await env.OAUTH_KV.delete(key).catch(() => undefined);
  return true;
}

async function repositoriesAdded(
  env: WebhookEnv,
  installationId: number,
  body: Payload,
  holders: string[],
  fetcher: typeof fetch,
) {
  await selectionChanged(env, installationId, body);
  const added = list(body.repositories_added).map((repository) => ({
    ...repository,
    installationId,
    url: cloneUrl(repository.fullName),
  }));
  if (added.length === 0) return true;
  // Each holder may have a project that is one of these, and each is asked
  // about on their own: that the organisation added a repository does not
  // mean every member can read it.
  for (const userId of holders) {
    // One member who has to connect again must not stop the others, nor make
    // GitHub deliver the same event again.
    await linkMatching(env, userId, added, fetcher, { listedForUser: false }).catch(
      () => undefined,
    );
  }
  return true;
}

async function selectionChanged(env: WebhookEnv, installationId: number, body: Payload) {
  if (body.repository_selection !== "all" && body.repository_selection !== "selected") return;
  await db(env)
    .update(schema.githubInstallations)
    .set({ repositorySelection: body.repository_selection, updatedAt: new Date() })
    .where(eq(schema.githubInstallations.installationId, installationId))
    .run();
}

/** How many earlier addresses of one repository are remembered. */
const MAX_PREVIOUS = 20;

/**
 * A repository under a new name, or a new owner. GitHub's id for it is the
 * same, which is how the projects that are this repository are found; their
 * address and key follow the name, so the next machine to join still
 * recognises the project as its own.
 *
 * On Exeora Cloud the address is what the next machine clones, so it follows
 * too, and the one it had is kept beside it: a machine that is set up again
 * holds a checkout of the old address, and has to be told that it is the
 * same repository rather than another one.
 */
async function renamed(env: WebhookEnv, repository: NamedRepository): Promise<boolean> {
  const url = cloneUrl(repository.fullName);
  const now = Date.now();
  const cloud = await db(env)
    .select({
      projectId: schema.cloudProjects.projectId,
      repoUrl: schema.cloudProjects.repoUrl,
      previousRepoUrls: schema.cloudProjects.previousRepoUrls,
    })
    .from(schema.cloudProjects)
    .innerJoin(
      schema.githubRepositories,
      eq(schema.githubRepositories.projectId, schema.cloudProjects.projectId),
    )
    .where(eq(schema.githubRepositories.repoId, repository.id))
    .all();
  const moved = cloud
    .filter((row) => row.repoUrl !== url)
    .map((row) => {
      // Renamed back to a name it had before, that name is its address
      // again and no longer one of the earlier ones.
      const previous = [...previousUrls(row.previousRepoUrls), row.repoUrl].filter(
        (earlier, index, all) => earlier !== url && all.indexOf(earlier) === index,
      );
      return env.DB.prepare(
        `UPDATE cloud_projects SET repo_url = ?2, previous_repo_urls = ?3, updated_at = ?4
          WHERE project_id = ?1`,
      ).bind(row.projectId, url, JSON.stringify(previous.slice(-MAX_PREVIOUS)), now);
    });
  await env.DB.batch([
    ...moved,
    env.DB.prepare(
      `UPDATE projects SET repo_url = ?2, repo_key = ?3
        WHERE id IN (SELECT project_id FROM github_repositories WHERE repo_id = ?1)`,
    ).bind(repository.id, url, repositoryKey(url)),
    env.DB.prepare(
      `UPDATE github_repositories SET full_name = ?2, private = ?3, updated_at = ?4
        WHERE repo_id = ?1`,
    ).bind(repository.id, repository.fullName, repository.private ? 1 : 0, now),
  ]);
  return true;
}

async function visibility(env: WebhookEnv, repository: NamedRepository): Promise<boolean> {
  await db(env)
    .update(schema.githubRepositories)
    .set({ private: repository.private, updatedAt: new Date() })
    .where(eq(schema.githubRepositories.repoId, repository.id))
    .run();
  return true;
}

/** Marks repositories as out of reach, within one installation when it is known. */
async function lost(
  env: WebhookEnv,
  repositoryIds: number[],
  installationId?: number,
): Promise<boolean> {
  const now = Date.now();
  // One statement per repository: a delivery can name more of them than a
  // single statement may bind.
  await env.DB.batch(
    repositoryIds.map((repositoryId) =>
      installationId === undefined
        ? env.DB.prepare(
            `UPDATE github_repositories SET lost_access_at = ?2, updated_at = ?2
              WHERE repo_id = ?1 AND lost_access_at IS NULL`,
          ).bind(repositoryId, now)
        : env.DB.prepare(
            `UPDATE github_repositories SET lost_access_at = ?2, updated_at = ?2
              WHERE repo_id = ?1 AND installation_id = ?3 AND lost_access_at IS NULL`,
          ).bind(repositoryId, now, installationId),
    ),
  );
  return true;
}

function id(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function named(value: unknown): NamedRepository | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as { id?: unknown; full_name?: unknown; private?: unknown };
  const repositoryId = id(raw.id);
  // Two segments and nothing that could turn the name into another address.
  if (repositoryId === null || typeof raw.full_name !== "string") return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.full_name)) return null;
  return { id: repositoryId, fullName: raw.full_name, private: raw.private === true };
}

function list(value: unknown): NamedRepository[] {
  if (!Array.isArray(value)) return [];
  return value.map(named).filter((repository) => repository !== null);
}

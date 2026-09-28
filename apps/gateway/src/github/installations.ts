import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { GitHubAccountType, GitHubRepositorySelection } from "../db/schema-github.js";
import "../env.js";
import { newId } from "../ids.js";
import {
  expectOk,
  GITHUB_API,
  type GitHubConfig,
  type GitHubEnv,
  GitHubError,
  githubConfig,
  githubFetch,
  githubHeaders,
} from "./app.js";
import { pendingPermissions, storedPermissions } from "./permissions.js";
import { repositoriesCacheKey } from "./repositories.js";
import {
  type GitHubPerson,
  type GrantedTokens,
  parseGrant,
  storeUserTokens,
  TOKEN_ENDPOINT,
} from "./user-token.js";

/**
 * Which installations of the app an account holds.
 *
 * An installation belongs to a person or an organisation on GitHub, not to an
 * Exeora account, and the only party that knows who may use one is GitHub.
 * So an account is given an installation in exactly one way: GitHub lists it
 * for the person who just authorized, in answer to their own token.
 */

export type ConnectionEnv = GitHubEnv & Pick<Env, "DB" | "OAUTH_KV">;

export interface InstallationView {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  repositorySelection: GitHubRepositorySelection;
  suspended: boolean;
  /**
   * What the app asks for and this installation has not granted, by GitHub's
   * names. Empty when nothing is waiting, and when GitHub has not said yet.
   */
  pendingPermissions: string[];
  /** Where the installation is changed or removed, on GitHub. */
  manageUrl: string;
}

/** Why a connection was refused, as the callback names it to the dashboard. */
export type ConnectionFailure =
  | "github_disabled"
  | "code_rejected"
  | "installation_not_visible"
  | "no_installation"
  | "github_unavailable";

export type Connection =
  | { ok: true; installations: number; login: string }
  | { ok: false; reason: ConnectionFailure; message: string };

/** Where a person installs the app, or changes what an installation may reach. */
export function connectUrl(env: Pick<Env, "GITHUB_APP_SLUG">, state: string): string {
  const slug = encodeURIComponent(env.GITHUB_APP_SLUG ?? "");
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** The page of one installation on GitHub, which differs for an organisation. */
export function manageUrl(installation: {
  installationId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
}): string {
  return installation.accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`
    : `https://github.com/settings/installations/${installation.installationId}`;
}

interface UserInstallation {
  id: number;
  app_id: number;
  account: { login: string; type: string } | null;
  repository_selection: string;
  suspended_at: string | null;
  /** What the installation granted the app, by name and level. */
  permissions?: unknown;
}

/** How many pages of a hundred a listing is followed for before it is cut short. */
const MAX_PAGES = 10;

/**
 * Finishes what the callback started: learns who authorized, and which
 * installations GitHub says are theirs.
 *
 * The installation id in the callback's address is whatever the browser was
 * sent there with, and anyone can write one. It is believed only when it is
 * among the installations GitHub lists for the person whose code this is;
 * otherwise nothing is stored. Without that check, naming another
 * organisation's installation would be enough to clone its repositories.
 */
export async function completeConnection(
  env: ConnectionEnv,
  userId: string,
  input: { code: string; installationId: number | null },
  fetcher: typeof fetch,
): Promise<Connection> {
  const config = githubConfig(env);
  if (!config) {
    return failure("github_disabled", "This gateway is not connected to a GitHub App.");
  }

  let visible: UserInstallation[];
  let person: GitHubPerson;
  let granted: GrantedTokens;
  try {
    const token = await exchangeCode(config, input.code, fetcher);
    if (!token) {
      return failure(
        "code_rejected",
        "GitHub did not accept the authorization, which expires ten minutes after it is given. Connect again.",
      );
    }
    granted = token;
    visible = (await userInstallations(token.accessToken, fetcher)).filter(
      (installation) => String(installation.app_id) === config.appId,
    );
    person = await whoAuthorized(token.accessToken, fetcher);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return failure("github_unavailable", error.message);
  }

  if (
    input.installationId !== null &&
    !visible.some((installation) => installation.id === input.installationId)
  ) {
    return failure(
      "installation_not_visible",
      "GitHub does not list that installation for the account that authorized. Install the app from the account that owns the repositories, or ask an owner of the organisation to.",
    );
  }
  const usable = visible.filter(
    (
      installation,
    ): installation is UserInstallation & { account: { login: string; type: string } } =>
      installation.account !== null,
  );
  if (usable.length === 0) {
    return failure(
      "no_installation",
      "The app is not installed on any account you can reach. Install it on GitHub, then connect again.",
    );
  }

  const now = new Date();
  const database = db(env);
  for (const installation of usable) {
    const permissions = storedPermissions(installation.permissions);
    const values = {
      accountLogin: installation.account.login,
      accountType: accountType(installation.account.type),
      repositorySelection: selection(installation.repository_selection),
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      // Left as it was when GitHub did not say: what a webhook stored is
      // worth more than a blank.
      ...(permissions === null ? {} : { permissions }),
      updatedAt: now,
    };
    await database
      .insert(schema.githubInstallations)
      .values({ id: newId("ghi"), userId, installationId: installation.id, ...values })
      .onConflictDoUpdate({
        target: [schema.githubInstallations.userId, schema.githubInstallations.installationId],
        set: values,
      })
      .run();
  }

  // What the account held and this person is not shown is let go of. The
  // account may have connected as somebody else before, and what that person
  // could reach is not what this one can.
  const seen = new Set(usable.map((installation) => installation.id));
  const held = await database
    .select({
      id: schema.githubInstallations.id,
      installationId: schema.githubInstallations.installationId,
    })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.userId, userId))
    .all();
  for (const row of held) {
    if (!seen.has(row.installationId)) await disconnect(env, userId, row.id);
  }

  await storeUserTokens(env, config, userId, person, granted, now.getTime());
  // The lists kept for the picker were made for whoever was connected before.
  for (const row of held) {
    await env.OAUTH_KV.delete(repositoriesCacheKey(userId, row.installationId));
  }

  return { ok: true, installations: usable.length, login: person.login };
}

export async function listInstallations(
  env: Pick<Env, "DB">,
  userId: string,
): Promise<InstallationView[]> {
  const rows = await db(env)
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.userId, userId))
    .orderBy(schema.githubInstallations.accountLogin)
    .all();
  return rows.map((row) => ({
    id: row.id,
    installationId: row.installationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    suspended: row.suspendedAt !== null,
    pendingPermissions: pendingPermissions(row.permissions),
    manageUrl: manageUrl(row),
  }));
}

/**
 * Takes an installation away from an account, and with it the access of the
 * projects that cloned through it. The app stays installed on GitHub, where
 * other accounts may be using it: the answer says where to remove it there.
 */
export async function disconnect(
  env: Pick<Env, "DB">,
  userId: string,
  installationRowId: string,
): Promise<{ manageUrl: string } | null> {
  const row = await db(env)
    .select()
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.id, installationRowId),
        eq(schema.githubInstallations.userId, userId),
      ),
    )
    .get();
  if (!row) return null;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM github_installations WHERE id = ?1 AND user_id = ?2").bind(
      row.id,
      userId,
    ),
    env.DB.prepare(
      `UPDATE github_repositories SET lost_access_at = ?3, updated_at = ?3
        WHERE user_id = ?1 AND installation_id = ?2 AND lost_access_at IS NULL`,
    ).bind(userId, row.installationId, Date.now()),
    // With the last connection goes the token that spoke for the person on
    // GitHub: there is nothing left for it to be used for, and a credential
    // nobody can use is one that can only be lost.
    env.DB.prepare(
      `DELETE FROM github_user_tokens
        WHERE user_id = ?1
          AND NOT EXISTS (
            SELECT 1 FROM github_installations WHERE user_id = ?1 AND id != ?2
          )`,
    ).bind(userId, row.id),
  ]);
  return { manageUrl: manageUrl(row) };
}

async function exchangeCode(
  config: GitHubConfig,
  code: string,
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
      code,
    }),
  });
  await expectOk(response);
  // A code that is wrong or spent is answered 200 with an `error` in the body.
  return parseGrant(await response.json());
}

async function userInstallations(
  userToken: string,
  fetcher: typeof fetch,
): Promise<UserInstallation[]> {
  const found: UserInstallation[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await githubFetch(
      fetcher,
      `${GITHUB_API}/user/installations?per_page=100&page=${page}`,
      { headers: githubHeaders(`Bearer ${userToken}`) },
    );
    await expectOk(response);
    const body = (await response.json()) as { installations?: UserInstallation[] };
    const batch = Array.isArray(body.installations) ? body.installations : [];
    found.push(...batch);
    if (batch.length < 100) break;
  }
  return found;
}

async function whoAuthorized(userToken: string, fetcher: typeof fetch): Promise<GitHubPerson> {
  const response = await githubFetch(fetcher, `${GITHUB_API}/user`, {
    headers: githubHeaders(`Bearer ${userToken}`),
  });
  await expectOk(response);
  const body = (await response.json()) as { login?: unknown; id?: unknown };
  if (typeof body.login !== "string" || body.login === "") {
    throw new GitHubError(502, "GitHub did not say who authorized. Connect again.");
  }
  return {
    login: body.login,
    id: typeof body.id === "number" && Number.isSafeInteger(body.id) ? body.id : null,
  };
}

function accountType(value: string): GitHubAccountType {
  return value === "Organization" ? "Organization" : "User";
}

function selection(value: string): GitHubRepositorySelection {
  return value === "all" ? "all" : "selected";
}

function failure(reason: ConnectionFailure, message: string): Connection {
  return { ok: false, reason, message };
}

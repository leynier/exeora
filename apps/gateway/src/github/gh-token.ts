import { repositoryKey } from "@exeora/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { githubConfig } from "./app.js";
import { currentUserToken, type UserTokenEnv } from "./user-token.js";

/**
 * What `gh` in an instance speaks to GitHub with.
 *
 * Git there holds a token of the installation, cut down to one repository
 * and to what git does. `gh` does what a person does: reads an issue, looks
 * at a run, comments on a pull request. So it acts as the person, with the
 * token GitHub gave them when they connected, and reaches what they reach.
 *
 * A project that was never connected may have a token somebody pasted, kept
 * for its clones. It is the next best thing and is answered in its place,
 * for a repository on github.com only: `gh` sends its token to GitHub, and
 * a token made for another host is not GitHub's to be shown.
 */

export interface GhToken {
  host: "github.com";
  token: string;
  /** Milliseconds since the epoch, or null for a token that says no end. */
  expiresAt: number | null;
  login: string | null;
  /** `user` is the person's own, `stored` the one kept for the project's clones. */
  source: "user" | "stored";
}

/** Why there is nothing to answer with, as the route names it. */
export type GhTokenRefusal = "no_credential" | "not_github" | "github_disabled";

const HOST = "github.com";

/**
 * The token for a project of `userId`, or why there is none. Throws a
 * `GitHubError` when the person's token had to be renewed and could not be.
 *
 * Who is asking is not checked here: the route has done that, and answers
 * nobody but the machine that was made for the project.
 */
export async function ghToken(
  env: UserTokenEnv,
  userId: string,
  projectId: string,
  fetcher: typeof fetch,
  now: number = Date.now(),
): Promise<GhToken | GhTokenRefusal> {
  const enabled = githubConfig(env) !== null;
  if (enabled && (await connected(env, userId, projectId))) {
    const { token, expiresAt, login } = await currentUserToken(env, userId, fetcher, now);
    return { host: HOST, token, expiresAt, login, source: "user" };
  }

  const stored = await storedToken(env, userId, projectId);
  if (stored !== null) return stored;
  // Said only once there was nothing kept either: a token that was pasted
  // needs no app to be answered with.
  return enabled ? "no_credential" : "github_disabled";
}

/** Whether the project is a repository of the connection, and still within reach. */
async function connected(env: Pick<Env, "DB">, userId: string, projectId: string) {
  const link = await db(env)
    .select({ projectId: schema.githubRepositories.projectId })
    .from(schema.githubRepositories)
    .where(
      and(
        eq(schema.githubRepositories.projectId, projectId),
        eq(schema.githubRepositories.userId, userId),
        isNull(schema.githubRepositories.lostAccessAt),
      ),
    )
    .get();
  return link !== undefined;
}

async function storedToken(
  env: Pick<Env, "DB" | "CLOUD_CREDENTIALS_KEY">,
  userId: string,
  projectId: string,
): Promise<GhToken | "not_github" | null> {
  const project = await db(env)
    .select({
      repoUrl: schema.cloudProjects.repoUrl,
      ciphertext: schema.cloudProjects.credentialCiphertext,
    })
    .from(schema.cloudProjects)
    .where(
      and(eq(schema.cloudProjects.projectId, projectId), eq(schema.cloudProjects.userId, userId)),
    )
    .get();
  if (!project?.ciphertext) return null;
  // Before it is opened: a token for another host is not even read.
  if (!repositoryKey(project.repoUrl)?.startsWith(`${HOST}/`)) return "not_github";

  const key = env.CLOUD_CREDENTIALS_KEY?.trim();
  if (!key) return null;
  try {
    const token = await decryptSecret(key, project.ciphertext);
    if (token === "") return null;
    // Nothing kept says when a pasted token ends, or whose it is.
    return { host: HOST, token, expiresAt: null, login: null, source: "stored" };
  } catch {
    // Kept under a key this gateway no longer has, which is as good as not kept.
    return null;
  }
}

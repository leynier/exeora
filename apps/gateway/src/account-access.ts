import { and, eq, isNull } from "drizzle-orm";
import { rememberAuthorization, revokeAccountProjectsExcept } from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { ownedProjectIds } from "./oauth/target.js";

/**
 * "All of my projects, including the ones I add later."
 *
 * On the account URL a client reaches exactly the projects it holds a row for,
 * and that stays true here. What this adds is the standing answer: a client
 * that was given everything gets its row written when a project is created,
 * so a new project is reachable from the first call rather than from the
 * moment somebody remembers to tick it on another page.
 *
 * The rows stay the authority. Nothing in the call path reads this table, which
 * is what keeps revoking one project from a client meaning what it always did.
 */

export interface AccountClientIdentity {
  clientName: string | undefined;
  clientUri: string | undefined;
}

/** The account screen's answer: which projects, and whether that means all of them from now on. */
export interface AccountChoice {
  projectIds: string[];
  allProjects: boolean;
}

/**
 * Reads the answer off the consent form, narrowed to this user's own projects.
 *
 * The form is attacker-controlled, so an id that is not theirs is dropped
 * rather than refused: refusing would say whether it exists. "All of them"
 * names no project, which also makes it the one answer an account with no
 * project yet can give.
 */
export async function accountChoice(
  env: Pick<Env, "DB">,
  userId: string,
  form: FormData,
): Promise<AccountChoice> {
  const allProjects = form.get("access") === "all";
  const projectIds = allProjects
    ? await everyProjectId(env, userId)
    : await ownedProjectIds(
        env,
        userId,
        form.getAll("project").map((value) => String(value)),
      );
  return { projectIds, allProjects };
}

/** Whether this client was given every project, and what it is called. */
export async function accountAccess(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<typeof schema.accountClients.$inferSelect | undefined> {
  return db(env)
    .select()
    .from(schema.accountClients)
    .where(
      and(
        eq(schema.accountClients.userId, entry.userId),
        eq(schema.accountClients.clientId, entry.clientId),
      ),
    )
    .get();
}

/** Every project of an account, for the answer that names none of them. */
export async function everyProjectId(env: Pick<Env, "DB">, userId: string): Promise<string[]> {
  const rows = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .all();
  return rows.map((row) => row.id);
}

/**
 * Records the answer without touching any project's row.
 *
 * `authorizedAt` moves only when `consented` says this is the consent screen
 * speaking: flipping the switch from the dashboard changes what the client
 * reaches, not when it was let in.
 */
export async function setAccountAccess(
  env: Pick<Env, "DB">,
  entry: {
    userId: string;
    clientId: string;
    allProjects: boolean;
    consented?: boolean;
  } & Partial<AccountClientIdentity>,
): Promise<void> {
  const now = new Date();
  await db(env)
    .insert(schema.accountClients)
    .values({
      userId: entry.userId,
      clientId: entry.clientId,
      allProjects: entry.allProjects,
      clientName: entry.clientName ?? null,
      clientUri: entry.clientUri ?? null,
      authorizedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.accountClients.userId, schema.accountClients.clientId],
      set: {
        allProjects: entry.allProjects,
        ...(entry.clientName ? { clientName: entry.clientName } : {}),
        ...(entry.clientUri ? { clientUri: entry.clientUri } : {}),
        ...(entry.consented ? { authorizedAt: now } : {}),
      },
    })
    .run();
}

/**
 * What the account consent screen decided, written in one place.
 *
 * What was not named is taken away, after the additions, so a re-approval that
 * keeps everything never passes through a moment with nothing granted.
 */
export async function rememberAccountAuthorization(
  env: Pick<Env, "DB">,
  entry: {
    userId: string;
    clientId: string;
    projectIds: readonly string[];
    allProjects: boolean;
  } & AccountClientIdentity,
): Promise<void> {
  for (const projectId of entry.projectIds) {
    await rememberAuthorization(env, {
      userId: entry.userId,
      projectId,
      clientId: entry.clientId,
      endpoint: "account",
      clientName: entry.clientName,
      clientUri: entry.clientUri,
    });
  }

  await revokeAccountProjectsExcept(env, {
    userId: entry.userId,
    clientId: entry.clientId,
    keep: entry.projectIds,
  });

  await setAccountAccess(env, { ...entry, consented: true });
}

/**
 * Gives a project that was just created to the clients that should have it.
 *
 * Those are the ones holding the standing answer, plus any the person named
 * while creating the project. A named client counts only if it is already
 * connected through the account URL: this is a way to extend a connection, not
 * to make one, and a client id nobody authorized must not become a row.
 *
 * Never throws. The project exists by now, and failing its creation over a
 * convenience would leave the caller with an error for something that worked.
 */
export async function grantNewProject(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientIds?: readonly string[] | undefined },
): Promise<void> {
  try {
    const database = db(env);
    const standing = await database
      .select()
      .from(schema.accountClients)
      .where(
        and(
          eq(schema.accountClients.userId, entry.userId),
          eq(schema.accountClients.allProjects, true),
        ),
      )
      .all();

    const clients = new Map<string, AccountClientIdentity>(
      standing.map((row) => [
        row.clientId,
        { clientName: row.clientName ?? undefined, clientUri: row.clientUri ?? undefined },
      ]),
    );

    const named = [...new Set(entry.clientIds ?? [])].filter((id) => !clients.has(id));
    if (named.length > 0) {
      const connected = await database
        .select({
          clientId: schema.projectClients.clientId,
          clientName: schema.projectClients.clientName,
          clientUri: schema.projectClients.clientUri,
        })
        .from(schema.projectClients)
        .where(
          and(
            eq(schema.projectClients.userId, entry.userId),
            eq(schema.projectClients.endpoint, "account"),
            isNull(schema.projectClients.revokedAt),
          ),
        )
        .all();

      for (const row of connected) {
        if (!named.includes(row.clientId)) continue;
        const known = clients.get(row.clientId);
        // Rows come back in no order and only some carry the name, so one that
        // has it wins over one that does not.
        if (known?.clientName) continue;
        clients.set(row.clientId, {
          clientName: row.clientName ?? undefined,
          clientUri: row.clientUri ?? known?.clientUri,
        });
      }
    }

    for (const [clientId, identity] of clients) {
      await rememberAuthorization(env, {
        userId: entry.userId,
        projectId: entry.projectId,
        clientId,
        endpoint: "account",
        ...identity,
      });
    }
  } catch (error) {
    console.error("could not grant a new project to account clients", error);
  }
}

/**
 * Ends the standing answer for one client, or for every client of an account
 * when none is named.
 *
 * Called when a project is taken away from a client by hand, because "all of
 * them" stopped being true at that moment, and when a connection is cut off,
 * because a client with no token must not keep collecting projects.
 */
export async function endAllProjects(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<void> {
  await db(env)
    .update(schema.accountClients)
    .set({ allProjects: false })
    .where(
      and(
        eq(schema.accountClients.userId, entry.userId),
        eq(schema.accountClients.clientId, entry.clientId),
      ),
    )
    .run();
}

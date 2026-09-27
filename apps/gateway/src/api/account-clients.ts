import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { endAllProjects, everyProjectId, setAccountAccess } from "../account-access.js";
import { rememberAuthorization, revokeAccountProjectsExcept } from "../clients.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { ownedProjectIds } from "../oauth/target.js";
import { revokeAccountGrants } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * The clients connected through the account URL, `exeora.dev/mcp`.
 *
 * One entry per client rather than per project, because on this endpoint a
 * client is a single connection that reaches several projects. Which of them it
 * may reach is an access list the user edits here. Calls name a project when
 * that list contains more than one, so no shared working-project state lives
 * on the client row.
 */

export const accountClients = new Hono<ApiEnv>();

/**
 * The clients connected through the account URL, one entry each.
 *
 * Grouped here rather than in the dashboard because the grouping is the whole
 * point of the view: on this endpoint a client is one connection covering
 * several projects, and listing it once per project would describe it as
 * several connections that happen to share a name.
 */
accountClients.get("/api/account-clients", async (c) => {
  const userId = c.get("userId");

  const rows = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(eq(schema.projectClients.userId, userId), eq(schema.projectClients.endpoint, "account")),
    )
    .orderBy(desc(schema.projectClients.authorizedAt))
    .all();

  const standing = await db(c.env)
    .select()
    .from(schema.accountClients)
    .where(eq(schema.accountClients.userId, userId))
    .all();
  const everything = new Set(standing.filter((row) => row.allProjects).map((row) => row.clientId));

  const byClient = new Map<string, ReturnType<typeof toAccountClientView>>();

  for (const row of rows) {
    const existing = byClient.get(row.clientId);
    if (!existing) {
      byClient.set(row.clientId, {
        ...toAccountClientView(row),
        allProjects: everything.has(row.clientId),
        projects: [toAccountProjectView(row)],
      });
      continue;
    }

    existing.projects.push(toAccountProjectView(row));

    // Folded across every row rather than read off the first one. A call on
    // this endpoint resolves to one project and only marks that project's row,
    // so the newest-authorized row is routinely not the one that was last used
    // and reading it alone would report a busy connection as never used. The
    // same for what the client called itself, which only one row may carry.
    existing.lastUsedAt = latest(existing.lastUsedAt, row.lastUsedAt?.getTime() ?? null);
    existing.mcpName ??= row.mcpName;
    existing.mcpVersion ??= row.mcpVersion;
    existing.clientName ??= row.clientName;
    existing.clientUri ??= row.clientUri;
  }

  // A client given everything before the account had any project holds no row
  // yet. It is connected all the same, and hiding it would leave a live token
  // that no page admits to.
  for (const row of standing) {
    if (!row.allProjects || byClient.has(row.clientId)) continue;
    byClient.set(row.clientId, {
      clientId: row.clientId,
      clientName: row.clientName,
      clientUri: row.clientUri,
      mcpName: null,
      mcpVersion: null,
      authorizedAt: row.authorizedAt.getTime(),
      lastUsedAt: null,
      allProjects: true,
      projects: [],
    });
  }

  return c.json([...byClient.values()]);
});

const accessInput = z.object({
  // In the body rather than the path: under CIMD a client id is a URL, and a
  // URL inside a path segment is a percent-encoding problem waiting to happen.
  clientId: z.string().min(1),
  projectIds: z.array(z.string().min(1)),
  /**
   * "All of my projects, including the ones I add later." When set, the list
   * is ignored: everything the account has is granted, and what it gets next
   * will be.
   */
  allProjects: z.boolean().default(false),
});

/**
 * Sets which projects a client reaches through the account URL.
 *
 * The same statement the consent screen makes, from the other side: what is in
 * the list is granted or restored, and what is missing is revoked. Revoking
 * rather than deleting, so the audit history stays attributable.
 *
 * Never touches `endpoint = "project"` rows. Access given through a project's
 * own URL is a different consent, and this page is not where it is answered.
 */
accountClients.put("/api/account-clients/projects", zValidator("json", accessInput), async (c) => {
  const userId = c.get("userId");
  const { clientId, projectIds, allProjects } = c.req.valid("json");

  const existing = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, clientId),
        eq(schema.projectClients.endpoint, "account"),
      ),
    )
    .all();

  const known = standing(await accountClientRow(c.env, userId, clientId));
  if (existing.length === 0 && !known) return c.json({ error: "not_found" }, 404);

  if (allProjects) {
    const every = await everyProjectId(c.env, userId);
    const identity = existing.find((row) => row.clientName !== null) ?? existing[0] ?? known;
    const granted = new Set(
      existing.filter((row) => row.revokedAt === null).map((row) => row.projectId),
    );
    // A token that was cut off does not come back from here, for the same
    // reason a single project cannot revive one: only the client can ask again.
    if (granted.size === 0 && !known) return c.json({ error: "not_connected" }, 409);

    for (const projectId of every) {
      if (granted.has(projectId)) continue;
      await rememberAuthorization(c.env, {
        userId,
        projectId,
        clientId,
        endpoint: "account",
        clientName: identity?.clientName ?? undefined,
        clientUri: identity?.clientUri ?? undefined,
      });
    }
    await setAccountAccess(c.env, {
      userId,
      clientId,
      allProjects: true,
      clientName: identity?.clientName ?? undefined,
      clientUri: identity?.clientUri ?? undefined,
    });
    return c.json({ ok: true });
  }

  // The same narrowing the consent screen does with its tick boxes, and for the
  // same reason: the list is caller-controlled, so an id that is not this
  // user's is dropped rather than refused.
  const keep = await ownedProjectIds(c.env, userId, projectIds);

  // An empty list is how this page cuts a connection off, and the dashboard
  // asks before sending one. A list that arrives non-empty and narrows to
  // nothing is not that decision: every id in it was stale or someone else's,
  // so the request meant "keep these" and answering it by taking the token away
  // would be the opposite, unasked and not undoable from here.
  if (projectIds.length > 0 && keep.length === 0) return c.json({ error: "not_found" }, 404);

  // Identity is copied from a row that already exists rather than looked up in
  // KV: it is the same client, and this is not a new authorization. A row that
  // carries a name is preferred, because these come back in no particular order
  // and copying a nameless one would blank the name everywhere it lands.
  const identity = existing.find((row) => row.clientName !== null) ?? existing[0] ?? known;
  if (!identity) return c.json({ error: "not_found" }, 404);

  // Only what is not already granted. `rememberAuthorization` stamps
  // `authorizedAt`, which is when consent was given, and editing the list here
  // is not a new consent for the projects it leaves alone: writing to them
  // would make the dashboard report every untouched project as authorized just
  // now, on an edit that only took one away.
  const alreadyGranted = new Set(
    existing.filter((row) => row.revokedAt === null).map((row) => row.projectId),
  );

  for (const projectId of keep) {
    if (alreadyGranted.has(projectId)) continue;

    await rememberAuthorization(c.env, {
      userId,
      projectId,
      clientId,
      endpoint: "account",
      clientName: identity.clientName ?? undefined,
      clientUri: identity.clientUri ?? undefined,
    });
  }

  await revokeAccountProjectsExcept(c.env, { userId, clientId, keep });
  // A list that names its projects is the opposite of the standing answer.
  await endAllProjects(c.env, { userId, clientId });

  // Emptying the list is how this screen shuts a connection off, so it also
  // takes the token, exactly as revoking the last project one at a time does.
  // Leaving the grant alive would let a client that reaches nothing keep asking.
  if (keep.length === 0) await revokeAccountGrants(c.env, userId, clientId);

  return c.json({ ok: true });
});

async function accountClientRow(env: Pick<Env, "DB">, userId: string, clientId: string) {
  return db(env)
    .select()
    .from(schema.accountClients)
    .where(
      and(eq(schema.accountClients.userId, userId), eq(schema.accountClients.clientId, clientId)),
    )
    .get();
}

/** The row, when it still says "everything": that alone keeps a connection with no project alive. */
function standing<Row extends { allProjects: boolean }>(row: Row | undefined): Row | undefined {
  return row?.allProjects ? row : undefined;
}

function toAccountClientView(client: typeof schema.projectClients.$inferSelect) {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    mcpName: client.mcpName,
    mcpVersion: client.mcpVersion,
    authorizedAt: client.authorizedAt.getTime(),
    lastUsedAt: client.lastUsedAt?.getTime() ?? null,
    allProjects: false,
    projects: [] as ReturnType<typeof toAccountProjectView>[],
  };
}

function toAccountProjectView(client: typeof schema.projectClients.$inferSelect) {
  return {
    id: client.id,
    projectId: client.projectId,
    revokedAt: client.revokedAt?.getTime() ?? null,
  };
}

/** The later of two timestamps, either of which may be missing. */
function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

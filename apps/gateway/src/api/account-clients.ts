import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { setActiveProjectId } from "../client-targets.js";
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
 * may reach is an access list the user edits here, and which one it is working
 * in right now is a pointer this endpoint moves.
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

  const [rows, active] = await Promise.all([
    db(c.env)
      .select()
      .from(schema.projectClients)
      .where(
        and(
          eq(schema.projectClients.userId, userId),
          eq(schema.projectClients.endpoint, "account"),
        ),
      )
      .orderBy(desc(schema.projectClients.authorizedAt))
      .all(),
    db(c.env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, userId))
      .all(),
  ]);

  const activeByClient = new Map(active.map((row) => [row.clientId, row.projectId]));
  const byClient = new Map<string, ReturnType<typeof toAccountClientView>>();

  for (const row of rows) {
    const existing = byClient.get(row.clientId);
    if (!existing) {
      byClient.set(row.clientId, {
        ...toAccountClientView(row),
        activeProjectId: activeByClient.get(row.clientId) ?? null,
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

  // The pointer outlives a revocation on purpose, so that resolving a call can
  // tell "never chose" from "chose something now gone" and refuse rather than
  // silently move the client. That distinction is worth nothing to this screen,
  // which only draws where the connection is working: a choice it can no longer
  // reach is not one, and offering it in the dropdown would invite picking it.
  for (const client of byClient.values()) {
    const reaches = new Set(
      client.projects.filter((entry) => entry.revokedAt === null).map((entry) => entry.projectId),
    );
    if (client.activeProjectId && !reaches.has(client.activeProjectId)) {
      client.activeProjectId = null;
    }
  }

  return c.json([...byClient.values()]);
});

const accessInput = z.object({
  // In the body rather than the path: under CIMD a client id is a URL, and a
  // URL inside a path segment is a percent-encoding problem waiting to happen.
  clientId: z.string().min(1),
  projectIds: z.array(z.string().min(1)),
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
  const { clientId, projectIds } = c.req.valid("json");

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

  if (existing.length === 0) return c.json({ error: "not_found" }, 404);

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
  const identity = existing.find((row) => row.clientName !== null) ?? existing[0];
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

  // Emptying the list is how this screen shuts a connection off, so it also
  // takes the token, exactly as revoking the last project one at a time does.
  // Leaving the grant alive would let a client that reaches nothing keep asking.
  if (keep.length === 0) await revokeAccountGrants(c.env, userId, clientId);

  return c.json({ ok: true });
});

const activeInput = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
});

/** Points a client at a project from the dashboard, or clears the pointer. */
accountClients.put(
  "/api/account-clients/active-project",
  zValidator("json", activeInput),
  async (c) => {
    const userId = c.get("userId");
    const { clientId, projectId } = c.req.valid("json");

    if (projectId !== null) {
      const granted = await db(c.env)
        .select({ id: schema.projectClients.id })
        .from(schema.projectClients)
        .where(
          and(
            eq(schema.projectClients.userId, userId),
            eq(schema.projectClients.clientId, clientId),
            eq(schema.projectClients.projectId, projectId),
            eq(schema.projectClients.endpoint, "account"),
            isNull(schema.projectClients.revokedAt),
          ),
        )
        .get();

      if (!granted) return c.json({ error: "not_found" }, 404);
    }

    await setActiveProjectId(c.env, { userId, clientId, projectId });
    return c.json({ ok: true });
  },
);
function toAccountClientView(client: typeof schema.projectClients.$inferSelect) {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    mcpName: client.mcpName,
    mcpVersion: client.mcpVersion,
    authorizedAt: client.authorizedAt.getTime(),
    lastUsedAt: client.lastUsedAt?.getTime() ?? null,
    activeProjectId: null as string | null,
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

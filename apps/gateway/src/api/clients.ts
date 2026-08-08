import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setActiveProjectId } from "../client-targets.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { forgetOAuthClient, revokeClient } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * The AI clients authorized against a project, through a per-project URL.
 *
 * The account URL's clients are a different view of the same table and live in
 * `account-clients.ts`: there a client is one connection covering several
 * projects, and listing it once per project would describe it as several.
 */

export const clients = new Hono<ApiEnv>();

/**
 * Every AI client authorized against one of the user's projects.
 *
 * Returned flat, with the project id on each row, because both consumers want
 * it differently: the Clients tab groups by project and the project page filters
 * to one. That is the same shape, and the same reasoning, as the audit log.
 */
clients.get("/api/clients", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(eq(schema.projectClients.userId, c.get("userId")))
    .orderBy(desc(schema.projectClients.authorizedAt))
    .all();

  return c.json(rows.map(toClientView));
});

/**
 * Revocation is a soft delete, as it is for machines: the row stays so the
 * dashboard can offer the second step, and the tool endpoint refuses a call
 * whose client has `revokedAt` set.
 *
 * The grants are what actually carry access, so they go too. A client may hold
 * several for the same project, one per time it was authorized, and every one
 * of them has to be found by the project id we recorded in its metadata.
 */
clients.delete("/api/clients/:id", async (c) => {
  const ok = await revokeClient(c.env, c.get("userId"), c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/**
 * Permanent deletion, allowed only once a client is revoked.
 *
 * Takes this project's audit history for that client with it, which is why it
 * is the second of two steps rather than the only one, exactly as for machines.
 */
clients.delete("/api/clients/:id/permanently", async (c) => {
  const userId = c.get("userId");

  const client = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.id, c.req.param("id")),
        eq(schema.projectClients.userId, userId),
      ),
    )
    .get();

  if (!client) return c.json({ error: "not_found" }, 404);
  if (client.revokedAt === null) return c.json({ error: "not_revoked" }, 409);

  // The calls this client made stay in the archive. Deleting a client used to
  // delete them too, back when they were D1 rows; the deletion queue erases by
  // account or by project, and a client is neither. What goes here is the
  // record of who the client was, not the record of what happened.
  await db(c.env)
    .delete(schema.projectClients)
    .where(eq(schema.projectClients.id, client.id))
    .run();

  // The pointer outlives a revocation on purpose, so a call can be refused
  // rather than quietly moved. It must not outlive *this*, which erases the
  // client's record rather than closing its access: there is no agent left to
  // protect, and the leftover row would meet the same client on its next
  // authorization and refuse its very first call, naming a project chosen by a
  // connection the user asked to forget.
  const remainingAccount = await db(c.env)
    .select({ id: schema.projectClients.id })
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, client.clientId),
        eq(schema.projectClients.endpoint, "account"),
      ),
    )
    .get();

  if (!remainingAccount) {
    await setActiveProjectId(c.env, { userId, clientId: client.clientId, projectId: null });
  }

  await forgetOAuthClient(c.env, client.clientId);

  return c.json({ ok: true });
});
function toClientView(client: typeof schema.projectClients.$inferSelect) {
  return {
    id: client.id,
    projectId: client.projectId,
    endpoint: client.endpoint,
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    mcpName: client.mcpName,
    mcpVersion: client.mcpVersion,
    authorizedAt: client.authorizedAt.getTime(),
    lastUsedAt: client.lastUsedAt?.getTime() ?? null,
    revokedAt: client.revokedAt?.getTime() ?? null,
  };
}

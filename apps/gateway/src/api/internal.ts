import { Hono } from "hono";
import { pendingAuditDeletions, retentionPolicy, settleAuditDeletion } from "../audit-deletions.js";
import "../env.js";

/**
 * The surface the archive maintenance job talks to.
 *
 * Mounted outside `/api/*` on purpose. That prefix is an `apiRoute` of the
 * OAuth provider, which demands a user access token before any handler runs,
 * and this caller is not a user: it is a scheduled job holding a shared secret.
 * Putting it behind the provider would mean minting a token for a robot and
 * giving that token an account.
 *
 * A deployment that has not set `AUDIT_MAINTENANCE_SECRET` answers 404 rather
 * than 401, for the same reason the admin panel does: an endpoint that can
 * schedule the erasure of an account's history should not confirm it exists to
 * someone who cannot use it.
 */

export const internal = new Hono<{ Bindings: Env }>();

internal.use("/internal/*", async (c, next) => {
  const expected = c.env.AUDIT_MAINTENANCE_SECRET;
  if (!expected) return c.notFound();

  const offered = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!timingSafeEqual(offered, expected)) return c.notFound();

  return next();
});

/**
 * What the archive still owes, oldest first.
 *
 * Returns the targets rather than a plan of statements: which SQL erases a
 * user from an Iceberg table is the job's business, and the gateway has no way
 * to run it anyway.
 */
internal.get("/internal/audit-deletions", async (c) => {
  return c.json({ items: await pendingAuditDeletions(c.env) });
});

/**
 * The retention the archive has to enforce tonight.
 *
 * Served rather than stamped onto each event: the account's plan is not read
 * anywhere on the tool-call path, so denormalising it would put a D1 row read
 * back on every call, which is the cost this whole archive exists to remove.
 */
internal.get("/internal/retention", async (c) => {
  return c.json(await retentionPolicy(c.env));
});

/**
 * Closes one target, or records why it could not be closed.
 *
 * The job calls this only after its catalog transaction has committed. Closing
 * a target first and deleting after would lose the instruction with nothing
 * deleted, and nothing else in the system remembers that the deletion was owed.
 */
internal.post("/internal/audit-deletions/:id", async (c) => {
  const body = await c.req.json<{ ok?: boolean; error?: string }>().catch(() => null);
  if (!body || typeof body.ok !== "boolean") {
    return c.json({ error: "bad_request" }, 400);
  }

  const settled = await settleAuditDeletion(
    c.env,
    c.req.param("id"),
    body.ok ? { ok: true } : { ok: false, error: body.error ?? "unspecified" },
  );

  // 404 covers both an id that never existed and one another run already
  // closed. The job treats them the same: stop asking about this target.
  return settled ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/** Constant-time compare so the secret cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

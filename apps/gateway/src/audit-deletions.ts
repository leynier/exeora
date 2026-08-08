import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import type { AuditDeletionScope } from "./db/schema.js";
import "./env.js";
import { newId } from "./ids.js";
import { retentionTiers } from "./plans.js";

/**
 * What the archive still owes the person who asked to be forgotten.
 *
 * D1 deletion is one statement and is already done by the time a route returns.
 * The archive cannot be: the Iceberg table is append-only from the gateway's
 * side, R2 SQL is read-only, and a row only goes when a maintenance job commits
 * a transaction through the catalog. So the gateway records the intent and a
 * job drains it, which is the whole reason `AUDIT-ARCHITECTURE.md` calls
 * pipeline-mode deletion asynchronous.
 *
 * Ordering is the part that matters. Every enqueue here has to happen *before*
 * the D1 delete it accompanies, because after it there is nothing left to read:
 * a machine's projects are gone with the machine, and an account's rows are
 * gone with the account.
 */

/** How many targets one maintenance run is handed at a time. */
const DRAIN_LIMIT = 100;

/**
 * Records that everything belonging to these targets must leave the archive.
 *
 * Never throws. A deletion the caller already committed to must not be undone
 * by bookkeeping failing, and a target that was not enqueued is recoverable:
 * it stays in the archive until someone notices, which is a smaller wrong than
 * a half-deleted account. The failure is logged loudly for that reason.
 */
export async function enqueueAuditDeletion(
  env: Pick<Env, "DB">,
  scope: AuditDeletionScope,
  targetIds: readonly string[],
): Promise<void> {
  if (targetIds.length === 0) return;

  try {
    await db(env)
      .insert(schema.auditDeletions)
      .values(
        targetIds.map((targetId) => ({
          id: newId("adl"),
          scope,
          targetId,
        })),
      )
      .run();
  } catch (error) {
    console.error("failed to enqueue an audit deletion", { scope, targetIds }, error);
  }
}

/**
 * The retention windows the archive has to enforce, and who is not on the
 * shortest one.
 *
 * Two statements a night come out of this, and the second is why the shape is
 * inverted. Deleting everything past the longest window needs no list at all.
 * Deleting past the shortest window has to spare the accounts on a longer plan,
 * and *those* are the small set: paying accounts are a fraction of all accounts,
 * so naming them scales where naming free accounts would not.
 *
 * The plan is read now rather than stamped onto each event, which also keeps
 * this matching `pruneToolCalls`: both answer "what is this account's retention
 * today", not "what was it when the call happened".
 */
export async function retentionPolicy(env: Pick<Env, "DB">): Promise<{
  shortestDays: number;
  longestDays: number;
  /** Accounts whose retention is longer than `shortestDays`. */
  exemptUserIds: string[];
}> {
  const tiers = retentionTiers();
  const shortestDays = Math.min(...tiers.map((tier) => tier.retentionDays));
  const longestDays = Math.max(...tiers.map((tier) => tier.retentionDays));

  const longerPlans = tiers
    .filter((tier) => tier.retentionDays > shortestDays)
    .map((tier) => tier.plan);

  const exempt =
    longerPlans.length === 0
      ? []
      : await db(env)
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(inArray(schema.users.plan, longerPlans))
          .all();

  return { shortestDays, longestDays, exemptUserIds: exempt.map((row) => row.id) };
}

/** Every project on a machine, read while the machine still exists. */
export async function projectIdsOfDevice(
  env: Pick<Env, "DB">,
  userId: string,
  deviceId: string,
): Promise<string[]> {
  const rows = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.deviceId, deviceId)))
    .all();

  return rows.map((row) => row.id);
}

/** What the maintenance job still has to do, oldest first. */
export async function pendingAuditDeletions(
  env: Pick<Env, "DB">,
): Promise<Array<{ id: string; scope: AuditDeletionScope; targetId: string; attempts: number }>> {
  return db(env)
    .select({
      id: schema.auditDeletions.id,
      scope: schema.auditDeletions.scope,
      targetId: schema.auditDeletions.targetId,
      attempts: schema.auditDeletions.attempts,
    })
    .from(schema.auditDeletions)
    .where(isNull(schema.auditDeletions.completedAt))
    .orderBy(asc(schema.auditDeletions.requestedAt))
    .limit(DRAIN_LIMIT)
    .all();
}

/**
 * Closes one target, or records why it could not be closed.
 *
 * Only the job may call this, and only once its transaction has committed.
 * Marking a target done before the catalog agrees would lose the instruction
 * with nothing having been deleted, which is the one outcome this table exists
 * to prevent.
 */
export async function settleAuditDeletion(
  env: Pick<Env, "DB">,
  id: string,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<boolean> {
  const result = await db(env)
    .update(schema.auditDeletions)
    .set({
      // Counted on every outcome, not just failures: a target that took four
      // tries is worth seeing even once it has finally gone through.
      attempts: sql`${schema.auditDeletions.attempts} + 1`,
      ...(outcome.ok
        ? { completedAt: new Date(), lastError: null }
        : { lastError: outcome.error.slice(0, 500) }),
    })
    .where(and(eq(schema.auditDeletions.id, id), isNull(schema.auditDeletions.completedAt)))
    .run();

  // Zero means it was already closed, which is the honest answer to a job that
  // retried a target another run had finished.
  return (result.meta.changes ?? 0) > 0;
}

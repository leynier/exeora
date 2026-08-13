import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
 * job drains it, which is the whole reason `docs/audit-architecture.md` calls
 * deletion from the archive asynchronous.
 *
 * Ordering is the part that matters. Every enqueue here has to happen *before*
 * the D1 delete it accompanies, because after it there is nothing left to read:
 * a machine's projects are gone with the machine, and an account's rows are
 * gone with the account.
 */

/** How many targets one maintenance run is handed at a time. */
const DRAIN_LIMIT = 100;
const LEASE_MS = 10 * 60_000;
const RECHECK_MS = 24 * 60 * 60_000;

/**
 * Records that everything belonging to these targets must leave the archive.
 *
 * Throws when D1 cannot persist the request. Destructive routes either include
 * this insert in the same D1 batch as their delete or stop without deleting.
 */
export async function enqueueAuditDeletion(
  env: Pick<Env, "DB">,
  scope: AuditDeletionScope,
  targetIds: readonly string[],
): Promise<void> {
  if (targetIds.length === 0) return;

  await db(env)
    .insert(schema.auditDeletions)
    .values(targetIds.map((targetId) => ({ id: newId("adl"), scope, targetId })))
    .onConflictDoNothing({ target: [schema.auditDeletions.scope, schema.auditDeletions.targetId] })
    .run();
}

/** Prepared insert used in a D1 batch with the destructive statement. */
export function auditDeletionStatement(
  env: Pick<Env, "DB">,
  scope: AuditDeletionScope,
  targetId: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO audit_deletions
       (id, scope, target_id, requested_at, attempts, next_attempt_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?4)`,
  ).bind(newId("adl"), scope, targetId, Date.now());
}

/** Inserts only when the project still belongs to this user. */
export function ownedProjectDeletionStatement(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
): D1PreparedStatement {
  const now = Date.now();
  return env.DB.prepare(
    `INSERT OR IGNORE INTO audit_deletions
       (id, scope, target_id, requested_at, attempts, next_attempt_at)
     SELECT ?1, 'project', id, ?2, 0, ?2
       FROM projects
      WHERE id = ?3 AND user_id = ?4`,
  ).bind(newId("adl"), now, projectId, userId);
}

/** Enqueues every project on a device in one statement, regardless of count. */
export function deviceProjectDeletionStatement(
  env: Pick<Env, "DB">,
  userId: string,
  deviceId: string,
): D1PreparedStatement {
  const operation = newId("adl");
  const now = Date.now();
  return env.DB.prepare(
    `INSERT OR IGNORE INTO audit_deletions
       (id, scope, target_id, requested_at, attempts, next_attempt_at)
     SELECT ?1 || '_' || id, 'project', id, ?2, 0, ?2
       FROM projects
      WHERE user_id = ?3 AND device_id = ?4`,
  ).bind(operation, now, userId, deviceId);
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
 * The plan is read now rather than stamped onto each event, which is also the
 * cheaper of the two: the account's plan is not read anywhere on the tool-call
 * path, so denormalising it would put a D1 row read back on every call. It
 * answers "what is this account's retention today" rather than "what was it
 * when the call happened", and today is the question the product asks.
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

/** Atomically leases a page so concurrent maintenance runs cannot duplicate work. */
export async function claimAuditDeletions(env: Pick<Env, "DB">): Promise<
  Array<{
    id: string;
    scope: AuditDeletionScope;
    targetId: string;
    attempts: number;
    leaseToken: string;
  }>
> {
  const now = Date.now();
  const leaseToken = newId("lsh");
  const rows = await env.DB.prepare(
    `UPDATE audit_deletions
        SET lease_token = ?1, lease_until = ?2, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM audit_deletions
         WHERE completed_at IS NULL
           AND next_attempt_at <= ?3
           AND (lease_until IS NULL OR lease_until <= ?3)
         ORDER BY requested_at, id
         LIMIT ?4
      )
      RETURNING id, scope, target_id, attempts`,
  )
    .bind(leaseToken, now + LEASE_MS, now, DRAIN_LIMIT)
    .all<{ id: string; scope: AuditDeletionScope; target_id: string; attempts: number }>();

  return rows.results.map((row) => ({
    id: row.id,
    scope: row.scope,
    targetId: row.target_id,
    attempts: row.attempts,
    leaseToken,
  }));
}

/**
 * Closes one target, or records why it could not be closed.
 *
 * Only the job may call this, and only once its transaction has committed.
 * The first successful pass is deliberately requeued; the second successful
 * pass closes it after the delayed-delivery window. Failed attempts never move
 * that counter.
 */
export async function settleAuditDeletion(
  env: Pick<Env, "DB">,
  id: string,
  leaseToken: string,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<boolean> {
  const now = Date.now();
  const result = outcome.ok
    ? await env.DB.prepare(
        `UPDATE audit_deletions
            SET completed_at = CASE WHEN successful_passes + 1 >= 2 THEN ?1 ELSE NULL END,
                successful_passes = successful_passes + 1,
                next_attempt_at = CASE WHEN successful_passes + 1 >= 2 THEN ?1 ELSE ?2 END,
                lease_token = NULL,
                lease_until = NULL,
                last_error = NULL
          WHERE id = ?3 AND completed_at IS NULL AND lease_token = ?4`,
      )
        .bind(now, now + RECHECK_MS, id, leaseToken)
        .run()
    : await env.DB.prepare(
        `UPDATE audit_deletions
            SET next_attempt_at = ?1,
                lease_token = NULL,
                lease_until = NULL,
                last_error = ?2
          WHERE id = ?3 AND completed_at IS NULL AND lease_token = ?4`,
      )
        .bind(now + retryDelay(now), outcome.error.slice(0, 500), id, leaseToken)
        .run();

  // Zero means it was already closed, which is the honest answer to a job that
  // retried a target another run had finished.
  return (result.meta.changes ?? 0) > 0;
}

function retryDelay(_now: number): number {
  return 5 * 60_000;
}

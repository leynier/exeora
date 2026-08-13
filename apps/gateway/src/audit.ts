import { and, eq, isNull } from "drizzle-orm";
import type { CallerIdentity } from "./clients.js";
import { observePipeline } from "./cost-metrics.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { newId } from "./ids.js";

/** Versioned record written to the durable analytics stream. */
export interface AuditEvent extends Record<string, unknown> {
  schema_version: 1;
  id: string;
  user_id: string;
  project_id: string;
  tool: string;
  status: "ok" | "error";
  duration_ms: number;
  error_code?: string;
  client_id?: string;
  client_name?: string;
  endpoint: "project" | "account";
  created_at: string;
}

export interface AuditHandle {
  id: string;
  startedAt: number;
}

type AuditEnv = Pick<Env, "DB"> & { AUDIT_STREAM?: Env["AUDIT_STREAM"] };

const DELIVERY_BATCH = 25;
const LEASE_MS = 60_000;
const STALE_STARTED_MS = 15 * 60_000;
const ACCEPTED_GRACE_MS = 7 * 24 * 60 * 60_000;

/**
 * Persists the audit intent before a tool is allowed to execute.
 *
 * This write is the fail-closed boundary. If it fails, dispatch returns without
 * touching the user's machine. Everything after it is recoverable by the
 * outbox sweeper, including a Worker dying after the command itself finished.
 */
export async function beginAudit(
  env: Pick<Env, "DB">,
  entry: {
    userId: string;
    projectId: string;
    tool: string;
    endpoint: "project" | "account";
    caller: CallerIdentity;
  },
): Promise<AuditHandle> {
  const id = newId("call");
  const startedAt = Date.now();
  const clientName = entry.caller.clientName ?? entry.caller.mcp?.name;

  await db(env)
    .insert(schema.auditOutbox)
    .values({
      id,
      userId: entry.userId,
      projectId: entry.projectId,
      tool: entry.tool,
      endpoint: entry.endpoint,
      clientId: entry.caller.clientId,
      clientName,
      nextAttemptAt: new Date(startedAt),
      createdAt: new Date(startedAt),
    })
    .run();

  return { id, startedAt };
}

/** Makes a started row ready for delivery without changing the command result. */
export async function finishAudit(
  env: AuditEnv,
  handle: AuditHandle,
  outcome: { status: "ok" | "error"; errorCode?: string },
): Promise<void> {
  const now = Date.now();
  await db(env)
    .update(schema.auditOutbox)
    .set({
      status: outcome.status,
      durationMs: Math.max(0, now - handle.startedAt),
      errorCode: outcome.errorCode,
      readyAt: new Date(now),
      nextAttemptAt: new Date(now),
      lastError: null,
    })
    .where(and(eq(schema.auditOutbox.id, handle.id), isNull(schema.auditOutbox.acceptedAt)))
    .run();

  // Keep the low-latency path the old direct Pipeline write provided. Failure
  // is safe now: the row remains ready for the scheduled retry.
  await flushAuditOutbox(env).catch((error) => {
    console.error("audit outbox flush failed", error);
  });
}

/**
 * Claims and delivers one batch. Pipeline delivery is at-least-once: a crash
 * after `send` but before the D1 acknowledgement can retry the same stable id,
 * and warehouse reads deduplicate that id.
 */
export async function flushAuditOutbox(env: AuditEnv): Promise<number> {
  const now = Date.now();
  const leaseToken = newId("lsh");
  const claimed = await env.DB.prepare(
    `UPDATE audit_outbox
       SET lease_token = ?1,
           lease_until = ?2,
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM audit_outbox
        WHERE status IS NOT NULL
          AND accepted_at IS NULL
          AND next_attempt_at <= ?3
          AND (lease_until IS NULL OR lease_until <= ?3)
        ORDER BY ready_at, id
        LIMIT ?4
     )
     RETURNING id, user_id, project_id, tool, status, duration_ms, error_code,
               client_id, client_name, endpoint, created_at, attempts`,
  )
    .bind(leaseToken, now + LEASE_MS, now, DELIVERY_BATCH)
    .all<OutboxRow>();

  if (claimed.results.length === 0) return 0;

  const events = claimed.results.map(eventFromOutbox);
  try {
    if (!env.AUDIT_STREAM) throw new Error("AUDIT_STREAM is not configured");
    await env.AUDIT_STREAM.send(events);
    for (const event of events) observePipeline(event.id, "accepted");

    await env.DB.prepare(
      `UPDATE audit_outbox
          SET accepted_at = ?1, lease_token = NULL, lease_until = NULL, last_error = NULL
        WHERE lease_token = ?2`,
    )
      .bind(Date.now(), leaseToken)
      .run();
    return events.length;
  } catch (error) {
    for (const event of events) observePipeline(event.id, "failed");
    const attempts = Math.max(...claimed.results.map((row) => row.attempts));
    await env.DB.prepare(
      `UPDATE audit_outbox
          SET next_attempt_at = ?1,
              lease_token = NULL,
              lease_until = NULL,
              last_error = ?2
        WHERE lease_token = ?3`,
    )
      .bind(Date.now() + retryDelay(attempts), describe(error), leaseToken)
      .run();
    throw error;
  }
}

/** Recovers interrupted rows, retries delivery and bounds acknowledged storage. */
export async function reconcileAuditOutbox(env: AuditEnv): Promise<number> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE audit_outbox
        SET status = 'error',
            duration_ms = max(0, ?1 - created_at),
            error_code = 'AUDIT_INCOMPLETE',
            ready_at = ?1,
            next_attempt_at = ?1,
            last_error = 'The Worker ended before the tool outcome was recorded.'
      WHERE status IS NULL AND created_at <= ?2`,
  )
    .bind(now, now - STALE_STARTED_MS)
    .run();

  const delivered = await flushAuditOutbox(env);

  await env.DB.prepare(
    "DELETE FROM audit_outbox WHERE accepted_at IS NOT NULL AND accepted_at < ?1",
  )
    .bind(now - ACCEPTED_GRACE_MS)
    .run();
  return delivered;
}

/** Direct sender kept as a narrow seam for tests and operational tooling. */
export async function writeAuditEvent(
  env: Pick<AuditEnv, "AUDIT_STREAM">,
  event: AuditEvent,
): Promise<void> {
  if (!env.AUDIT_STREAM) {
    observePipeline(event.id, "failed");
    throw new Error("AUDIT_STREAM is not configured");
  }
  try {
    await env.AUDIT_STREAM.send([event]);
    observePipeline(event.id, "accepted");
  } catch (error) {
    observePipeline(event.id, "failed");
    throw error;
  }
}

export function auditEvent(
  id: string,
  entry: {
    userId: string;
    projectId: string;
    tool: string;
    status: "ok" | "error";
    durationMs: number;
    errorCode?: string;
    endpoint?: "project" | "account";
    caller: CallerIdentity;
  },
): AuditEvent {
  const clientName = entry.caller.clientName ?? entry.caller.mcp?.name;
  return {
    schema_version: 1,
    id,
    user_id: entry.userId,
    project_id: entry.projectId,
    tool: entry.tool,
    status: entry.status,
    duration_ms: entry.durationMs,
    ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    ...(entry.caller.clientId ? { client_id: entry.caller.clientId } : {}),
    ...(clientName ? { client_name: clientName } : {}),
    endpoint: entry.endpoint ?? "project",
    created_at: new Date().toISOString(),
  };
}

interface OutboxRow {
  id: string;
  user_id: string;
  project_id: string;
  tool: string;
  status: "ok" | "error";
  duration_ms: number;
  error_code: string | null;
  client_id: string | null;
  client_name: string | null;
  endpoint: "project" | "account";
  created_at: number;
  attempts: number;
}

function eventFromOutbox(row: OutboxRow): AuditEvent {
  return {
    schema_version: 1,
    id: row.id,
    user_id: row.user_id,
    project_id: row.project_id,
    tool: row.tool,
    status: row.status,
    duration_ms: row.duration_ms,
    ...(row.error_code ? { error_code: row.error_code } : {}),
    ...(row.client_id ? { client_id: row.client_id } : {}),
    ...(row.client_name ? { client_name: row.client_name } : {}),
    endpoint: row.endpoint,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function retryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 2 ** Math.min(attempts, 10) * 1000);
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

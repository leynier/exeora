import type { AuditEvent } from "./audit.js";
import { observePipeline } from "./cost-metrics.js";
import { db, schema } from "./db/client.js";
import "./env.js";

/** An intent is unresolved, not a failed tool, until this window has elapsed. */
export const AUDIT_INCOMPLETE_AFTER_MS = 15 * 60_000;
export const AUDIT_INCOMPLETE_CODE = "AUDIT_INCOMPLETE";

type StreamEnv = Pick<Env, "DB"> & { AUDIT_STREAM?: Env["AUDIT_STREAM"] };

/**
 * The stream acknowledges ingestion, not just a local buffer. Await that
 * acknowledgement before execution. An unavailable stream falls back to the
 * existing D1 intent; if neither durable store works, beginAudit fails closed.
 */
export async function tryStreamIntent(env: StreamEnv, event: AuditEvent): Promise<boolean> {
  if (!env.AUDIT_STREAM) return false;
  try {
    await sendAuditStream(env, event);
    return true;
  } catch {
    return false;
  }
}

/**
 * A second record completes the same stable id and timestamp. The reader must
 * resolve the pair before applying status filters. No D1 request is needed on
 * the successful path; an interrupted Worker leaves the durable intent behind.
 */
export async function finishStreamIntent(
  env: StreamEnv,
  intent: AuditEvent,
  startedAt: number,
  outcome: { status: "ok" | "error"; errorCode?: string },
): Promise<void> {
  const now = Date.now();
  const { error_code: _intentError, ...base } = intent;
  const event: AuditEvent = {
    ...base,
    status: outcome.status,
    duration_ms: Math.max(0, now - startedAt),
    ...(outcome.errorCode ? { error_code: outcome.errorCode } : {}),
  };

  try {
    await sendAuditStream(env, event);
  } catch (error) {
    // The intent is already durable. Preserve the exact outcome for retry as
    // well, including when ingestion succeeded but its acknowledgement was
    // lost. Warehouse queries deduplicate all copies using the same event id.
    // Do not immediately flush: the stream just failed, so respect backoff.
    await db(env)
      .insert(schema.auditOutbox)
      .values({
        id: event.id,
        userId: event.user_id,
        projectId: event.project_id,
        workspaceId: event.schema_version === 2 ? event.worktree_id : undefined,
        workspaceSlug: event.schema_version === 2 ? event.worktree_slug : undefined,
        tool: event.tool,
        endpoint: event.endpoint,
        clientId: event.client_id,
        clientName: event.client_name,
        status: event.status,
        durationMs: event.duration_ms,
        errorCode: event.error_code,
        readyAt: new Date(now),
        nextAttemptAt: new Date(now + 2_000),
        createdAt: new Date(startedAt),
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      })
      .onConflictDoNothing({ target: schema.auditOutbox.id })
      .run();
  }
}

export async function sendAuditStream(
  env: { AUDIT_STREAM?: Env["AUDIT_STREAM"] },
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

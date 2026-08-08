import type { CallerIdentity } from "./clients.js";
import { observePipeline } from "./cost-metrics.js";
import "./env.js";

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

export type AuditWriteMode = "d1" | "dual" | "pipeline";

export function auditWriteMode(
  env: Pick<Env, "AUDIT_WRITE_MODE" | "AUDIT_STREAM">,
): AuditWriteMode {
  const requested =
    env.AUDIT_WRITE_MODE === "dual" || env.AUDIT_WRITE_MODE === "pipeline"
      ? env.AUDIT_WRITE_MODE
      : "d1";
  // Mis-provisioned dual/pipeline must not silently run as D1 (false confidence)
  // or as pipeline without a stream (skipped D1 + failed sink = lost audit).
  if (requested !== "d1" && !env.AUDIT_STREAM) {
    throw new Error(`AUDIT_WRITE_MODE=${requested} requires the AUDIT_STREAM binding`);
  }
  return requested;
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

export async function writeAuditEvent(
  env: Pick<Env, "AUDIT_STREAM">,
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

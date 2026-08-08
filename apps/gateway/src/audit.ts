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

/**
 * The binding is optional here even though the generated `Env` makes it
 * required. Those types describe this repository's `wrangler.jsonc`; a
 * self-hosted gateway that never provisioned Pipelines has no such binding,
 * and this is where that shows up.
 */
type AuditEnv = { AUDIT_STREAM?: Env["AUDIT_STREAM"] };

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

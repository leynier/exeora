import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditEvent,
  beginAudit,
  finishAudit,
  flushAuditOutbox,
  reconcileAuditOutbox,
  writeAuditEvent,
} from "./audit.js";
import { db, schema } from "./db/client.js";

beforeEach(async () => {
  await db(env).delete(schema.auditOutbox).run();
});

const sender = () =>
  vi.fn<(events: Record<string, unknown>[]) => Promise<void>>(async () => undefined);

describe("audit pipeline event", () => {
  it("emits the versioned, argument-free warehouse schema", () => {
    const event = auditEvent("call_1", {
      userId: "usr_1",
      projectId: "prj_1",
      tool: "read_file",
      status: "ok",
      durationMs: 12,
      caller: {
        clientId: "client_1",
        clientName: "Claude",
        mcp: { name: "claude-code", version: "2.0" },
      },
    });

    expect(event).toMatchObject({
      schema_version: 1,
      id: "call_1",
      user_id: "usr_1",
      project_id: "prj_1",
      duration_ms: 12,
      client_id: "client_1",
      client_name: "Claude",
      endpoint: "project",
    });
    expect(event).not.toHaveProperty("arguments");
    expect(event).not.toHaveProperty("result");
  });

  it("sends one record through the binding", async () => {
    const send = sender();
    const event = auditEvent("call_2", {
      userId: "usr_1",
      projectId: "prj_1",
      tool: "grep",
      status: "error",
      durationMs: 4,
      errorCode: "TOOL_FAILED",
      caller: { clientId: undefined, clientName: undefined, mcp: undefined },
    });

    await writeAuditEvent({ AUDIT_STREAM: { send } }, event);

    expect(send).toHaveBeenCalledWith([event]);
  });

  it("persists before delivery and acknowledges the same stable event id", async () => {
    const send = sender();
    const auditEnv = { DB: env.DB, AUDIT_STREAM: { send } };
    const handle = await beginAudit(auditEnv, {
      userId: "usr_1",
      projectId: "prj_1",
      tool: "read_file",
      endpoint: "project",
      caller: { clientId: "client_1", clientName: "Claude", mcp: undefined },
    });

    const started = await db(env)
      .select()
      .from(schema.auditOutbox)
      .where(eq(schema.auditOutbox.id, handle.id))
      .get();
    expect(started?.status).toBeNull();

    await finishAudit(auditEnv, handle, { status: "ok" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.[0]).toMatchObject({ id: handle.id, status: "ok" });
    const accepted = await db(env)
      .select()
      .from(schema.auditOutbox)
      .where(eq(schema.auditOutbox.id, handle.id))
      .get();
    expect(accepted?.acceptedAt).not.toBeNull();
  });

  it("retries a failed Pipeline send without changing the event id", async () => {
    const failedSend = vi.fn<(events: Record<string, unknown>[]) => Promise<void>>(async () => {
      throw new Error("pipeline unavailable");
    });
    const handle = await beginAudit(
      { DB: env.DB },
      {
        userId: "usr_1",
        projectId: "prj_1",
        tool: "grep",
        endpoint: "project",
        caller: { clientId: undefined, clientName: undefined, mcp: undefined },
      },
    );
    await finishAudit({ DB: env.DB, AUDIT_STREAM: { send: failedSend } }, handle, {
      status: "error",
      errorCode: "TOOL_FAILED",
    });

    const pending = await db(env)
      .select()
      .from(schema.auditOutbox)
      .where(eq(schema.auditOutbox.id, handle.id))
      .get();
    expect(pending?.acceptedAt).toBeNull();
    expect(pending?.lastError).toContain("pipeline unavailable");

    await db(env)
      .update(schema.auditOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.auditOutbox.id, handle.id))
      .run();
    const send = sender();
    expect(await flushAuditOutbox({ DB: env.DB, AUDIT_STREAM: { send } })).toBe(1);
    expect(send.mock.calls[0]?.[0]?.[0]?.id).toBe(handle.id);
  });

  it("recovers a Worker interruption as an explicit incomplete audit event", async () => {
    await db(env)
      .insert(schema.auditOutbox)
      .values({
        id: "call_interrupted",
        userId: "usr_1",
        projectId: "prj_1",
        tool: "run_command",
        endpoint: "project",
        nextAttemptAt: new Date(0),
        createdAt: new Date(0),
      })
      .run();
    const send = sender();

    expect(await reconcileAuditOutbox({ DB: env.DB, AUDIT_STREAM: { send } })).toBe(1);
    expect(send.mock.calls[0]?.[0]?.[0]).toMatchObject({
      id: "call_interrupted",
      status: "error",
      error_code: "AUDIT_INCOMPLETE",
    });
  });
});

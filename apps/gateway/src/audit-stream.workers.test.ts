import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_INCOMPLETE_CODE } from "./audit-stream.js";
import { beginAudit, finishAudit, flushAuditOutbox } from "./audit.js";
import { db, schema } from "./db/client.js";

const entry = {
  userId: "usr_stream",
  projectId: "prj_stream",
  workspaceId: "wsp_stream",
  workspaceSlug: "feature-one",
  tool: "read_file",
  endpoint: "project" as const,
  caller: { clientId: "client_1", clientName: "Claude", mcp: undefined },
};

beforeEach(async () => {
  await db(env).delete(schema.auditOutbox).run();
});

function sender() {
  return vi.fn<(events: Record<string, unknown>[]) => Promise<void>>(async () => undefined);
}

function forbiddenDatabase() {
  const prepare = vi.fn(() => {
    throw new Error("D1 is unavailable");
  });
  return { DB: { prepare } as unknown as D1Database, prepare };
}

describe("stream-first audit", () => {
  it("does not read or write D1 when both stream acknowledgements succeed", async () => {
    const { DB, prepare } = forbiddenDatabase();
    const send = sender();
    const auditEnv = { DB, AUDIT_STREAM: { send }, AUDIT_SCHEMA_VERSION: "2" };
    const handle = await beginAudit(auditEnv, entry);
    await finishAudit(auditEnv, handle, { status: "ok" });

    expect(prepare).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    const intent = send.mock.calls[0]?.[0]?.[0];
    const outcome = send.mock.calls[1]?.[0]?.[0];
    expect(intent).toMatchObject({
      id: handle.id,
      error_code: AUDIT_INCOMPLETE_CODE,
      worktree_id: "wsp_stream",
      worktree_slug: "feature-one",
    });
    expect(outcome).toMatchObject({
      id: handle.id,
      status: "ok",
      created_at: intent?.created_at,
      worktree_id: "wsp_stream",
    });
    expect(outcome).not.toHaveProperty("error_code");
    for (const event of [intent, outcome]) {
      expect(event).not.toHaveProperty("arguments");
      expect(event).not.toHaveProperty("result");
    }
  });

  it("does not return an execution handle before ingestion is acknowledged", async () => {
    const { DB } = forbiddenDatabase();
    let acknowledge: (() => void) | undefined;
    const acknowledged = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const send = vi.fn(async () => acknowledged);
    let ready = false;
    const pending = beginAudit({ DB, AUDIT_STREAM: { send } }, entry).then((handle) => {
      ready = true;
      return handle;
    });

    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
    acknowledge?.();
    expect((await pending).intent).toBeDefined();
  });

  it("falls back to a durable D1 intent when the stream fails", async () => {
    const send = sender().mockRejectedValue(new Error("stream unavailable"));
    const handle = await beginAudit({ DB: env.DB, AUDIT_STREAM: { send } }, entry);
    const row = await db(env)
      .select()
      .from(schema.auditOutbox)
      .where(eq(schema.auditOutbox.id, handle.id))
      .get();

    expect(handle.intent).toBeUndefined();
    expect(row?.status).toBeNull();
    expect(row?.workspaceId).toBe("wsp_stream");
  });

  it("fails closed when neither durable store accepts the intent", async () => {
    const { DB } = forbiddenDatabase();
    const send = sender().mockRejectedValue(new Error("stream unavailable"));
    await expect(beginAudit({ DB, AUDIT_STREAM: { send } }, entry)).rejects.toThrow();
  });

  it("preserves a failed outcome send in the retry outbox with the same id", async () => {
    const send = sender();
    const auditEnv = { DB: env.DB, AUDIT_STREAM: { send }, AUDIT_SCHEMA_VERSION: "2" };
    const handle = await beginAudit(auditEnv, entry);
    send.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await finishAudit(auditEnv, handle, { status: "error", errorCode: "TOOL_FAILED" });

    const queued = await db(env)
      .select()
      .from(schema.auditOutbox)
      .where(eq(schema.auditOutbox.id, handle.id))
      .get();
    expect(queued).toMatchObject({
      id: handle.id,
      status: "error",
      errorCode: "TOOL_FAILED",
      workspaceId: "wsp_stream",
      acceptedAt: null,
    });
    expect(queued?.createdAt.getTime()).toBe(handle.startedAt);
    expect(queued?.lastError).toContain("lost acknowledgement");
    expect(send).toHaveBeenCalledTimes(2);

    await db(env)
      .update(schema.auditOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.auditOutbox.id, handle.id))
      .run();
    expect(await flushAuditOutbox(auditEnv)).toBe(1);
    expect(send.mock.calls[2]?.[0]?.[0]).toMatchObject({
      id: handle.id,
      error_code: "TOOL_FAILED",
      created_at: new Date(handle.startedAt).toISOString(),
    });
  });

  it("still has a durable intent if the Worker never records an outcome", async () => {
    const { DB, prepare } = forbiddenDatabase();
    const send = sender();
    const handle = await beginAudit({ DB, AUDIT_STREAM: { send } }, entry);

    expect(handle.intent).toMatchObject({ id: handle.id, error_code: AUDIT_INCOMPLETE_CODE });
    expect(send).toHaveBeenCalledWith([handle.intent]);
    expect(prepare).not.toHaveBeenCalled();
  });
});

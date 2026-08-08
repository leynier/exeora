import { describe, expect, it, vi } from "vitest";
import { auditEvent, auditWriteMode, writeAuditEvent } from "./audit.js";

describe("audit pipeline event", () => {
  it("uses D1 unless a migration mode was explicitly selected", () => {
    expect(auditWriteMode({})).toBe("d1");
    const stream = { send: async () => undefined };
    expect(auditWriteMode({ AUDIT_WRITE_MODE: "dual", AUDIT_STREAM: stream })).toBe("dual");
    expect(auditWriteMode({ AUDIT_WRITE_MODE: "pipeline", AUDIT_STREAM: stream })).toBe("pipeline");
  });

  it("rejects dual/pipeline when AUDIT_STREAM is missing", () => {
    expect(() => auditWriteMode({ AUDIT_WRITE_MODE: "pipeline" })).toThrow(
      "AUDIT_WRITE_MODE=pipeline requires the AUDIT_STREAM binding",
    );
    expect(() => auditWriteMode({ AUDIT_WRITE_MODE: "dual" })).toThrow(
      "AUDIT_WRITE_MODE=dual requires the AUDIT_STREAM binding",
    );
  });

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
    const send = vi.fn(async () => undefined);
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
});

import { describe, expect, it } from "vitest";
import {
  BASELINE_CAPABILITIES,
  decodeExecutorMessage,
  decodeRelayMessage,
  type ExecutorMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type RelayMessage,
} from "./messages.js";
import { isToolName, TOOL_NAMES, toolInputSchema } from "./tools.js";

describe("executor → relay framing", () => {
  const cases: ExecutorMessage[] = [
    {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: "dev_123",
      cliVersion: "0.1.0",
      platform: "linux",
      projects: [{ id: "prj_1", slug: "exeora" }],
    },
    { type: "heartbeat", at: 1_754_400_000_000 },
    { type: "heartbeat" },
    { type: "presence", at: 1_754_400_000_000 },
    {
      type: "tool.result",
      requestId: "req_1",
      durationMs: 12,
      result: { ok: true, value: { path: "a.ts", content: "hi", truncated: false, totalLines: 1 } },
    },
    {
      type: "tool.result",
      requestId: "req_2",
      durationMs: 3,
      result: { ok: false, error: { code: "PATH_ESCAPE", message: "outside project root" } },
    },
    {
      type: "workspace.result",
      requestId: "workspace_1",
      durationMs: 7,
      result: {
        ok: true,
        value: {
          kind: "status",
          repository: true,
          head: "feature/trees",
          oid: "abc123",
          upstream: null,
          ahead: 0,
          behind: 0,
          operation: null,
          files: [],
          branches: [],
          remotes: [],
          gitWorktrees: [],
        },
      },
    },
    {
      type: "terminal.output",
      sessionId: "term_1",
      data: "aGVsbG8=",
    },
  ];

  it.each(cases)("round-trips $type", (message) => {
    expect(decodeExecutorMessage(encodeMessage(message))).toEqual(message);
  });
});

describe("relay → executor framing", () => {
  const cases: RelayMessage[] = [
    { type: "hello.ack", serverTime: 1_754_400_000_000, heartbeatIntervalMs: 30_000 },
    { type: "heartbeat.ack" },
    {
      type: "tool.call",
      requestId: "req_1",
      projectId: "prj_1",
      tool: "run_command",
      arguments: { command: "bun test" },
      issuedAt: 1_754_400_000_000,
      expiresAt: 1_754_400_060_000,
    },
    {
      type: "workspace.call",
      requestId: "workspace_1",
      projectId: "prj_1",
      worktreeId: "wtr_1",
      worktreeSlug: "feature-trees",
      action: { action: "status" },
      issuedAt: 1_754_400_000_000,
      expiresAt: 1_754_400_060_000,
    },
    {
      type: "workspace.call",
      requestId: "workspace_2",
      projectId: "prj_1",
      action: {
        action: "worktree_create",
        branch: "feature/from-dashboard",
        reuseExistingBranch: false,
      },
      issuedAt: 1_754_400_000_000,
      expiresAt: 1_754_400_060_000,
    },
    {
      type: "terminal.open",
      sessionId: "term_1",
      projectId: "prj_1",
      worktreeId: "wtr_1",
      worktreeSlug: "feature-trees",
      cols: 120,
      rows: 36,
    },
    { type: "cancel", requestId: "req_1" },
    { type: "shutdown", reason: "device revoked" },
  ];

  it.each(cases)("round-trips $type", (message) => {
    expect(decodeRelayMessage(encodeMessage(message))).toEqual(message);
  });
});

describe("malformed frames", () => {
  it("returns null for invalid JSON instead of throwing", () => {
    expect(decodeExecutorMessage("{not json")).toBeNull();
    expect(decodeRelayMessage("")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(decodeExecutorMessage(JSON.stringify({ type: "nope" }))).toBeNull();
  });

  it("rejects a tool.call naming a tool we do not serve", () => {
    const frame = JSON.stringify({
      type: "tool.call",
      requestId: "r",
      projectId: "p",
      tool: "rm_rf",
      arguments: {},
      issuedAt: 0,
      expiresAt: 1,
    });
    expect(decodeRelayMessage(frame)).toBeNull();
  });

  it("rejects a tool.result whose ok flag does not match its payload", () => {
    const frame = JSON.stringify({
      type: "tool.result",
      requestId: "r",
      durationMs: 1,
      result: { ok: true, error: { code: "TOOL_FAILED", message: "x" } },
    });
    expect(decodeExecutorMessage(frame)).toBeNull();
  });
});

describe("additive executor capabilities", () => {
  it("keeps old hello frames valid and preserves new workspace features", () => {
    const legacy = {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: "dev_legacy",
      cliVersion: "0.8.4",
      platform: "linux",
      projects: [{ id: "prj_1", slug: "exeora" }],
    } as const;
    expect(decodeExecutorMessage(JSON.stringify(legacy))).toEqual(legacy);

    const current = {
      ...legacy,
      deviceId: "dev_current",
      capabilities: {
        prompt: true,
        tools: [...BASELINE_CAPABILITIES.tools],
        features: ["source-control-v1", "terminal-v1"],
        worktreeRouting: true,
      },
    } as const;
    expect(decodeExecutorMessage(JSON.stringify(current))).toEqual(current);
  });
});

describe("tool registry", () => {
  it("exposes every tool, in a stable order", () => {
    expect(TOOL_NAMES).toEqual([
      "read_file",
      "list_files",
      "grep",
      "edit_file",
      "write_file",
      "list_git_worktrees",
      "create_worktree",
      "attach_worktree",
      "detach_worktree",
      "remove_worktree",
      "run_command",
      "start_command",
      "get_command_output",
      "send_command_input",
      "kill_command",
    ]);
  });

  it("keeps the baseline six frozen, whatever is added after them", () => {
    // What an executor built before capabilities existed is taken to support.
    // Derived from this list rather than from TOOL_NAMES, precisely so adding a
    // tool does not silently claim every published CLI can run it.
    expect(BASELINE_CAPABILITIES.tools).toEqual([
      "read_file",
      "list_files",
      "grep",
      "edit_file",
      "write_file",
      "run_command",
    ]);
  });

  it("recognises only known tool names", () => {
    expect(isToolName("read_file")).toBe(true);
    expect(isToolName("sudo")).toBe(false);
  });

  it("builds a validating schema from each input shape", () => {
    expect(toolInputSchema("read_file").safeParse({ path: "src/a.ts" }).success).toBe(true);
    expect(toolInputSchema("read_file").safeParse({}).success).toBe(false);
    expect(toolInputSchema("read_file").safeParse({ path: "" }).success).toBe(false);
  });

  it("caps run_command timeouts at the shared maximum", () => {
    const schema = toolInputSchema("run_command");
    expect(schema.safeParse({ command: "ls", timeoutMs: 300_000 }).success).toBe(true);
    expect(schema.safeParse({ command: "ls", timeoutMs: 300_001 }).success).toBe(false);
  });
});

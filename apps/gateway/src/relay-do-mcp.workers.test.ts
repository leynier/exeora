import { encodeMessage } from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { callRelayMcpTool } from "./relay-client.js";
import {
  attachFakeExecutor,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";

/**
 * The relay's downstream-MCP half, under workerd: what an executor's
 * announcement leaves behind, and how a call to one of its tools travels.
 */

beforeEach(freshRelay);

describe("downstream MCP servers", () => {
  const announcement = {
    type: "mcp.tools" as const,
    projectId: "prj_test",
    servers: [
      {
        name: "context7",
        status: "ready" as const,
        tools: [
          {
            name: "resolve-library-id",
            description: "Resolve a library name to its context7 id.",
            inputSchema: {
              type: "object",
              properties: { libraryName: { type: "string" } },
              required: ["libraryName"],
            },
            annotations: { readOnlyHint: true },
          },
        ],
      },
      {
        name: "broken",
        status: "error" as const,
        error: "Exited before the handshake.",
        tools: [],
      },
    ],
  };

  it("stores an announcement and reads it back through the RPC", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    executor.socket.send(encodeMessage(announcement));
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toEqual(announcement.servers);
    });
    executor.socket.close(1000, "done");
  });

  it("answers null for a project nothing was announced for", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    expect(await relay().mcpTools("prj_other")).toBeNull();
    executor.socket.close(1000, "done");
  });

  it("clears what was stored when the next announcement is empty", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    executor.socket.send(encodeMessage(announcement));
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toEqual(announcement.servers);
    });

    executor.socket.send(encodeMessage({ type: "mcp.tools", projectId: "prj_test", servers: [] }));
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toBeNull();
    });
    executor.socket.close(1000, "done");
  });

  it("keeps the last announcement when the executor goes offline", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    executor.socket.send(encodeMessage(announcement));
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toEqual(announcement.servers);
    });

    executor.socket.close(1000, "done");
    // Deliberate, the same philosophy as `capabilities` answering null: tools
    // that cannot run fail with LOCAL_EXECUTOR_OFFLINE, which says the true
    // thing, rather than vanishing from tools/list and looking broken.
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toEqual(announcement.servers);
    });
  });

  it("forgets the announcements of a revoked device", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    executor.socket.send(encodeMessage(announcement));
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toEqual(announcement.servers);
    });

    await relay().revoke();
    expect(await relay().mcpTools("prj_test")).toBeNull();
  });

  it("drops a frame a valid announcement could never have produced", async () => {
    const executor = await attachFakeExecutor();
    await executor.ack;

    // Malformed, so decodeExecutorMessage returns null and nothing is stored.
    executor.socket.send(
      JSON.stringify({
        type: "mcp.tools",
        projectId: "prj_test",
        servers: [{ name: "Not A Name", status: "ready", tools: [] }],
      }),
    );
    await eventually(async () => {
      expect(await relay().mcpTools("prj_test")).toBeNull();
    });
    executor.socket.close(1000, "done");
  });

  it("forwards an mcp call and settles its result like a canonical call", async () => {
    const executor = await attachFakeExecutor();

    const value = await callRelayMcpTool(relay(), {
      requestId: "req_mcp_1",
      projectId: "prj_test",
      server: "context7",
      tool: "resolve-library-id",
      args: { libraryName: "react" },
    });

    expect(value).toEqual({ content: [{ type: "text", text: "downstream resolve-library-id" }] });
    expect(executor.mcpSeen[0]).toMatchObject({
      requestId: "req_mcp_1",
      server: "context7",
      tool: "resolve-library-id",
    });
  });

  it("propagates a downstream error with its code intact", async () => {
    const _executor = await attachFakeExecutor({
      mcpRespond: () => ({
        ok: false,
        error: { code: "TOOL_FAILED", message: "the server refused the call" },
      }),
    });

    const error = await failureOf(() =>
      callRelayMcpTool(relay(), {
        requestId: "req_mcp_2",
        projectId: "prj_test",
        server: "context7",
        tool: "resolve-library-id",
        args: {},
      }),
    );

    expect(error.code).toBe("TOOL_FAILED");
  });

  it("fails fast when no executor is connected, rather than queueing", async () => {
    const error = await failureOf(() =>
      callRelayMcpTool(relay(), {
        requestId: "req_mcp_3",
        projectId: "prj_test",
        server: "context7",
        tool: "resolve-library-id",
        args: {},
      }),
    );

    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });
});

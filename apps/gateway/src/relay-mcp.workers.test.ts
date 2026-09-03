import { BASELINE_CAPABILITIES, type ExecutorCapabilities } from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { callRelayMcpTool } from "./relay-client.js";
import {
  attachFakeExecutor,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";
import { decodeMcpCatalog } from "./relay-mcp.js";

beforeEach(freshRelay);

const MCP_CAPABILITIES: ExecutorCapabilities = {
  ...BASELINE_CAPABILITIES,
  features: ["mcp-proxy-v1"],
  workspaceRouting: true,
};

const CATALOG = [
  {
    exposedName: "mcp__demo__echo",
    server: "demo",
    name: "echo",
    description: "Echo through the demo MCP server.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
];

describe("MCP relay", () => {
  it("filters malformed and duplicate catalog entries before registration", () => {
    const valid = CATALOG[0];
    if (!valid) throw new Error("catalog fixture is empty");
    expect(
      decodeMcpCatalog(JSON.stringify([valid, valid, { ...valid, exposedName: "grep" }])),
    ).toEqual([valid]);
  });

  it("stores the executor catalog and routes MCP calls independently from native tools", async () => {
    const executor = await attachFakeExecutor({
      capabilities: MCP_CAPABILITIES,
      mcpCatalog: CATALOG,
      mcpRespond: (call) => ({
        ok: true,
        value: {
          content: [{ type: "text", text: String((call.args as { message?: string }).message) }],
        },
      }),
    });
    await executor.ack;
    await eventually(async () => {
      expect(decodeMcpCatalog(await relay().mcpTools("prj_test"))).toEqual(CATALOG);
    });

    const value = await callRelayMcpTool(relay(), {
      requestId: "req_mcp",
      projectId: "prj_test",
      workspaceId: "wsp_feature",
      workspaceSlug: "feature",
      server: "demo",
      tool: "echo",
      args: { message: "hello" },
    });

    expect(value).toMatchObject({ content: [{ type: "text", text: "hello" }] });
    expect(executor.mcpSeen).toEqual([
      {
        requestId: "req_mcp",
        server: "demo",
        tool: "echo",
        args: { message: "hello" },
      },
    ]);
    expect(executor.seen).toEqual([]);
  });

  it("rejects MCP calls when the connected CLI does not advertise proxy support", async () => {
    await attachFakeExecutor({ capabilities: BASELINE_CAPABILITIES });
    const error = await failureOf(() =>
      callRelayMcpTool(relay(), {
        requestId: "req_old_mcp",
        projectId: "prj_test",
        server: "demo",
        tool: "echo",
        args: {},
      }),
    );

    expect(error.code).toBe("FORBIDDEN");
  });

  it("clears a previous executor's catalog when a new session connects", async () => {
    const previous = await attachFakeExecutor({
      capabilities: MCP_CAPABILITIES,
      mcpCatalog: CATALOG,
    });
    await previous.ack;
    await eventually(async () => {
      expect(decodeMcpCatalog(await relay().mcpTools("prj_test"))).toHaveLength(1);
    });

    const current = await attachFakeExecutor({ capabilities: MCP_CAPABILITIES });
    await current.ack;
    await eventually(async () => {
      expect(decodeMcpCatalog(await relay().mcpTools("prj_test"))).toEqual([]);
    });
  });
});

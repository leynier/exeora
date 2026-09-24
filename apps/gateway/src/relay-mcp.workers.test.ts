import { runInDurableObject } from "cloudflare:test";
import {
  BASELINE_CAPABILITIES,
  DEFAULT_POLICY,
  type ExecutorCapabilities,
  MAX_MCP_CATALOG_BYTES,
} from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { callRelayMcpTool } from "./relay-client.js";
import {
  attachFakeExecutor,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";
import { decodeMcpCatalogs, replaceMcpCatalog } from "./relay-mcp.js";

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
    annotations: { readOnlyHint: true },
  },
];

const stored = async () => decodeMcpCatalogs(await relay().mcpCatalogs(["prj_test"])).prj_test;

describe("MCP relay", () => {
  it("filters malformed and duplicate catalog entries before registration", () => {
    const valid = CATALOG[0];
    if (!valid) throw new Error("catalog fixture is empty");
    const long = { ...valid, exposedName: `mcp__demo__${"x".repeat(60)}` };
    expect(
      decodeMcpCatalogs(
        JSON.stringify({ prj_test: [valid, valid, { ...valid, exposedName: "grep" }, long] }),
      ),
    ).toEqual({ prj_test: [valid] });
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
      expect(await stored()).toEqual(CATALOG);
    });

    const value = await callRelayMcpTool(relay(), {
      requestId: "req_mcp",
      projectId: "prj_test",
      workspaceId: "wsp_feature",
      workspaceSlug: "feature",
      server: "demo",
      tool: "echo",
      args: { message: "hello" },
      policy: DEFAULT_POLICY,
    });

    expect(value).toMatchObject({ content: [{ type: "text", text: "hello" }] });
    expect(executor.mcpSeen).toEqual([
      {
        requestId: "req_mcp",
        server: "demo",
        tool: "echo",
        args: { message: "hello" },
        policy: DEFAULT_POLICY,
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
        policy: DEFAULT_POLICY,
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
      expect(await stored()).toHaveLength(1);
    });

    const current = await attachFakeExecutor({ capabilities: MCP_CAPABILITIES });
    await current.ack;
    await eventually(async () => {
      expect(await stored()).toEqual([]);
    });
  });

  it("forgets catalogs when the device is revoked", async () => {
    const executor = await attachFakeExecutor({
      capabilities: MCP_CAPABILITIES,
      mcpCatalog: CATALOG,
    });
    await executor.ack;
    await eventually(async () => {
      expect(await stored()).toHaveLength(1);
    });

    await relay().revoke();
    expect(await stored()).toEqual([]);
  });

  it("refuses a catalog above the byte budget instead of storing it", async () => {
    const huge = [{ ...CATALOG[0], description: "x".repeat(MAX_MCP_CATALOG_BYTES) }];
    await runInDurableObject(relay(), async (_instance, state) => {
      expect(await replaceMcpCatalog(state, "prj_test", CATALOG as never)).toBe(true);
      expect(await replaceMcpCatalog(state, "prj_test", huge as never)).toBe(false);
    });
    expect(await stored()).toEqual([]);
  });
});

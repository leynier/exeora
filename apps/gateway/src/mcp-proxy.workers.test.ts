import { describe, expect, it } from "vitest";
import { payload, post } from "./mcp-fixtures.js";

const tool = {
  exposedName: "mcp__demo__echo",
  server: "demo",
  name: "echo",
  description: "Echo a message through an upstream MCP server.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  },
};

describe("proxied MCP tools", () => {
  it("advertises the upstream schema plus Exeora's workspace routing field", async () => {
    const body = await payload(
      await post(
        { jsonrpc: "2.0", id: 40, method: "tools/list" },
        {
          mcpProxy: {
            tools: [tool],
            dispatch: async () => ({ content: [{ type: "text", text: "ok" }] }),
          },
        },
      ),
    );
    const tools = (
      body.result as {
        tools: Array<{
          name: string;
          inputSchema: { required?: string[]; properties?: Record<string, unknown> };
        }>;
      }
    ).tools;
    const proxied = tools.find((candidate) => candidate.name === tool.exposedName);

    expect(proxied?.inputSchema.required).toEqual(["message"]);
    expect(proxied?.inputSchema.properties).toHaveProperty("message");
    expect(proxied?.inputSchema.properties).toHaveProperty("workspace");
  });

  it("routes workspace separately and preserves the upstream CallToolResult", async () => {
    const seen: Array<{ workspace: string | undefined; name: string; args: unknown }> = [];
    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 41,
          method: "tools/call",
          params: {
            name: tool.exposedName,
            arguments: { message: "hello", workspace: "feature-api" },
          },
        },
        {
          mcpProxy: {
            tools: [tool],
            dispatch: async (context, name, args) => {
              seen.push({ workspace: context.workspace, name, args });
              return {
                content: [{ type: "text", text: "upstream response" }],
                structuredContent: { echoed: true },
              };
            },
          },
        },
      ),
    );

    expect(seen).toEqual([
      { workspace: "feature-api", name: tool.exposedName, args: { message: "hello" } },
    ]);
    expect(body.result).toMatchObject({
      content: [{ type: "text", text: "upstream response" }],
      structuredContent: { echoed: true },
    });
  });
});

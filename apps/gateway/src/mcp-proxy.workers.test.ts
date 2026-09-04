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

  it("skips a malformed proxy name instead of colliding with a native tool", async () => {
    const body = await payload(
      await post(
        { jsonrpc: "2.0", id: 42, method: "tools/list" },
        {
          mcpProxy: {
            tools: [{ ...tool, exposedName: "grep" }],
            dispatch: async () => ({ content: [{ type: "text", text: "bad" }] }),
          },
        },
      ),
    );
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.filter((candidate) => candidate.name === "grep")).toHaveLength(1);
    expect(tools.some((candidate) => candidate.name === "mcp__demo__echo")).toBe(false);
  });

  it("preserves an upstream workspace argument by moving Exeora routing aside", async () => {
    const colliding = {
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        properties: {
          ...tool.inputSchema.properties,
          workspace: { type: "string", description: "Upstream workspace value." },
        },
      },
    };
    const listed = await payload(
      await post(
        { jsonrpc: "2.0", id: 43, method: "tools/list" },
        {
          mcpProxy: {
            tools: [colliding],
            dispatch: async () => ({ content: [{ type: "text", text: "ok" }] }),
          },
        },
      ),
    );
    const tools = (
      listed.result as {
        tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>;
      }
    ).tools;
    const proxied = tools.find((candidate) => candidate.name === colliding.exposedName);
    expect(proxied?.inputSchema.properties).toHaveProperty("workspace");
    expect(proxied?.inputSchema.properties).toHaveProperty("__exeora_workspace");

    const seen: Array<{ workspace: string | undefined; args: unknown }> = [];
    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 44,
          method: "tools/call",
          params: {
            name: colliding.exposedName,
            arguments: {
              message: "hello",
              workspace: "upstream-owned",
              __exeora_workspace: "feature-api",
            },
          },
        },
        {
          mcpProxy: {
            tools: [colliding],
            dispatch: async (context, _name, args) => {
              seen.push({ workspace: context.workspace, args });
              return { content: [{ type: "text", text: "ok" }] };
            },
          },
        },
      ),
    );

    expect(seen).toEqual([
      {
        workspace: "feature-api",
        args: { message: "hello", workspace: "upstream-owned" },
      },
    ]);
  });
});

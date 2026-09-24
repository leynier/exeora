import { describe, expect, it } from "vitest";
import { PROJECT, payload, post, postModern } from "./mcp-fixtures.js";
import type { McpProxyCall, McpProxyDispatcher } from "./mcp-proxy-tools.js";

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
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const answer =
  (value: unknown, seen: McpProxyCall[] = []): McpProxyDispatcher =>
  async (call) => {
    seen.push(call);
    return { kind: "value", value };
  };

type Listed = {
  tools: Array<{
    name: string;
    description?: string;
    annotations?: Record<string, unknown>;
    inputSchema: { required?: string[]; properties?: Record<string, unknown> };
  }>;
};

async function list(tools: unknown[]) {
  const body = await payload(
    await post(
      { jsonrpc: "2.0", id: 40, method: "tools/list" },
      { mcpProxy: { tools: tools as never, dispatch: answer({}) } },
    ),
  );
  return (body.result as Listed).tools;
}

const call = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 41,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("proxied MCP tools", () => {
  it("advertises the upstream schema, its annotations and Exeora's workspace field", async () => {
    const proxied = (await list([tool])).find((candidate) => candidate.name === tool.exposedName);

    expect(proxied?.inputSchema.required).toEqual(["message"]);
    expect(proxied?.inputSchema.properties).toHaveProperty("message");
    expect(proxied?.inputSchema.properties).toHaveProperty("workspace");
    expect(proxied?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(proxied?.description).toContain("`demo` MCP server");
  });

  it("marks a tool with no readOnlyHint as one that changes something", async () => {
    const proxied = (await list([{ ...tool, annotations: undefined }])).find(
      (candidate) => candidate.name === tool.exposedName,
    );
    expect(proxied?.annotations?.readOnlyHint).toBe(false);
  });

  it("routes workspace separately and preserves the upstream CallToolResult", async () => {
    const seen: McpProxyCall[] = [];
    const body = await payload(
      await post(call(tool.exposedName, { message: "hello", workspace: "feature-api" }), {
        mcpProxy: {
          tools: [tool],
          dispatch: answer(
            {
              content: [{ type: "text", text: "upstream response" }],
              structuredContent: { echoed: true },
            },
            seen,
          ),
        },
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      projectId: PROJECT,
      workspace: "feature-api",
      tool: { exposedName: tool.exposedName, server: "demo", name: "echo" },
      args: { message: "hello" },
      approved: false,
      canElicit: false,
    });
    expect(body.result).toMatchObject({
      content: [{ type: "text", text: "upstream response" }],
      structuredContent: { echoed: true },
    });
  });

  it("passes an upstream isError result through as a result the model can read", async () => {
    const body = await payload(
      await post(call(tool.exposedName, { message: "boom" }), {
        mcpProxy: {
          tools: [tool],
          dispatch: answer({ content: [{ type: "text", text: "upstream failed" }], isError: true }),
        },
      }),
    );
    expect(body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "upstream failed" }],
    });
  });

  it("wraps a value that is not a CallToolResult as JSON instead of failing", async () => {
    const body = await payload(
      await post(call(tool.exposedName, { message: "raw" }), {
        mcpProxy: { tools: [tool], dispatch: answer({ unexpected: 1 }) },
      }),
    );
    expect(body.result).toMatchObject({
      content: [{ type: "text", text: '{"unexpected":1}' }],
      structuredContent: { unexpected: 1 },
    });
  });

  it("rejects arguments outside the upstream schema before dispatch", async () => {
    const seen: McpProxyCall[] = [];
    const body = await payload(
      await post(call(tool.exposedName, { message: 7 }), {
        mcpProxy: { tools: [tool], dispatch: answer({}, seen) },
      }),
    );
    expect(seen).toEqual([]);
    expect(JSON.stringify(body)).toMatch(/isError|error/);
  });

  it("skips a malformed proxy name instead of colliding with a native tool", async () => {
    const tools = await list([{ ...tool, exposedName: "grep" }]);

    expect(tools.filter((candidate) => candidate.name === "grep")).toHaveLength(1);
    expect(tools.some((candidate) => candidate.name === "mcp__demo__echo")).toBe(false);
  });

  it("drops only the tool whose schema cannot be registered", async () => {
    const broken = {
      ...tool,
      exposedName: "mcp__demo__broken",
      inputSchema: { type: "string" },
    };
    const tools = await list([broken, tool]);

    expect(tools.some((candidate) => candidate.name === "mcp__demo__broken")).toBe(false);
    expect(tools.some((candidate) => candidate.name === tool.exposedName)).toBe(true);
    expect(tools.some((candidate) => candidate.name === "read_file")).toBe(true);
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
    const proxied = (await list([colliding])).find(
      (candidate) => candidate.name === colliding.exposedName,
    );
    expect(proxied?.inputSchema.properties).toHaveProperty("workspace");
    expect(proxied?.inputSchema.properties).toHaveProperty("__exeora_workspace");

    const seen: McpProxyCall[] = [];
    await payload(
      await post(
        call(colliding.exposedName, {
          message: "hello",
          workspace: "upstream-owned",
          __exeora_workspace: "feature-api",
        }),
        { mcpProxy: { tools: [colliding], dispatch: answer({ content: [] }, seen) } },
      ),
    );

    expect(seen[0]).toMatchObject({
      workspace: "feature-api",
      args: { message: "hello", workspace: "upstream-owned" },
    });
  });

  it("asks a modern client to confirm and previews the upstream arguments", async () => {
    const body = await payload(
      await postModern(call(tool.exposedName, { message: "hello", workspace: "main" }), {
        mcpProxy: {
          tools: [tool],
          dispatch: async () => ({ kind: "needs-approval", projectId: PROJECT }),
        },
      }),
    );
    const result = body.result as {
      resultType?: string;
      inputRequests?: Record<string, { params?: { message?: string } }>;
      requestState?: string;
    };

    expect(result.resultType).toBe("input_required");
    const message = result.inputRequests?.approve?.params?.message ?? "";
    expect(message).toContain("`echo` from the `demo` MCP server");
    expect(message).toContain('{"message":"hello"}');
    expect(message).not.toContain("workspace");
    expect(typeof result.requestState).toBe("string");
  });

  it("never answers a 2025-era client with an input_required it cannot read", async () => {
    const body = await payload(
      await post(call(tool.exposedName, { message: "hello" }), {
        mcpProxy: {
          tools: [tool],
          dispatch: async () => ({ kind: "needs-approval", projectId: PROJECT }),
        },
      }),
    );
    expect(JSON.stringify(body)).not.toContain("input_required");
  });
});

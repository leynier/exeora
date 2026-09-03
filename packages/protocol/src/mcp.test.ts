import { describe, expect, it } from "vitest";
import {
  MAX_MCP_ANNOUNCEMENT_BYTES,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS_PER_SERVER,
  MCP_TOOL_PREFIX,
  McpToolsMessage,
  mcpToolName,
  parseMcpToolName,
} from "./index.js";

/**
 * The downstream-MCP surfaces of the contract: the announcement an executor
 * publishes, and the names its tools are republished under.
 *
 * The byte budgets (one schema, the whole announcement) are not enforced here:
 * zod cannot weigh serialized size. The executor honours them while building an
 * announcement and the relay honours the total before storing one, which is
 * what the relay suites assert.
 */

const tool = (over: Record<string, unknown> = {}) => ({
  name: "resolve-library-id",
  description: "Resolve a library name to its context7 id.",
  inputSchema: {
    type: "object",
    properties: { libraryName: { type: "string" } },
    required: ["libraryName"],
  },
  ...over,
});

describe("the announcement frame", () => {
  it("accepts a project's servers, ready and errored alike", () => {
    const message = McpToolsMessage.parse({
      type: "mcp.tools",
      projectId: "prj_1",
      servers: [
        { name: "context7", status: "ready", tools: [tool()] },
        { name: "broken", status: "error", error: "Exited before the handshake.", tools: [] },
      ],
    });

    expect(message.servers).toHaveLength(2);
    expect(message.servers[1]?.error).toBe("Exited before the handshake.");
  });

  it("rejects a server name that could not survive in a tool name", () => {
    expect(() =>
      McpToolsMessage.parse({
        type: "mcp.tools",
        projectId: "prj_1",
        servers: [{ name: "Not A Name", status: "ready", tools: [] }],
      }),
    ).toThrow();
  });

  it("bounds how many servers and tools one announcement carries", () => {
    const flood = Array.from({ length: MAX_MCP_SERVERS + 1 }, (_, index) => ({
      name: `server-${index}`,
      status: "ready",
      tools: [],
    }));
    expect(() =>
      McpToolsMessage.parse({ type: "mcp.tools", projectId: "prj_1", servers: flood }),
    ).toThrow();

    const manyTools = Array.from({ length: MAX_MCP_TOOLS_PER_SERVER + 1 }, (_, index) =>
      tool({ name: `tool_${index}` }),
    );
    expect(() =>
      McpToolsMessage.parse({
        type: "mcp.tools",
        projectId: "prj_1",
        servers: [{ name: "context7", status: "ready", tools: manyTools }],
      }),
    ).toThrow();
  });
});

describe("the republished tool name", () => {
  it("namespaces a downstream tool under its server", () => {
    expect(mcpToolName("context7", "resolve-library-id")).toBe(
      `${MCP_TOOL_PREFIX}context7__resolve-library-id`,
    );
  });

  it("splits back into the server and tool it came from", () => {
    expect(parseMcpToolName("mcp__context7__resolve-library-id")).toEqual({
      server: "context7",
      tool: "resolve-library-id",
    });
  });

  it("refuses names that are not ours, or not well formed", () => {
    expect(parseMcpToolName("read_file")).toBeNull();
    expect(parseMcpToolName("mcp__context7")).toBeNull();
    expect(parseMcpToolName("mcp__bad name__tool")).toBeNull();
    expect(parseMcpToolName("mcp__context7__")).toBeNull();
  });
});

describe("the announcement budget", () => {
  it("is set below the Durable Object storage value ceiling", () => {
    // 128 KiB per storage key: the relay keeps one announcement per project in
    // one key, so this bound is what makes storing it always possible.
    expect(MAX_MCP_ANNOUNCEMENT_BYTES).toBeLessThan(128 * 1024);
  });
});

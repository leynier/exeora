import {
  AGENT_PROMPT_NAME,
  AGENT_PROMPT_TOOL,
  agentPrompt,
  ExeoraError,
  TOOL_NAMES,
} from "@exeora/protocol";
import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { handshakeClientInfo, type McpToolContext, mcpRoute } from "./mcp.js";
import { initialize, PROJECT, payload, post } from "./mcp-fixtures.js";

/**
 * The MCP surface: what an agent actually sees, and what happens to its call
 * on the way to the executor.
 */

describe("tools/list", () => {
  it("advertises exactly the contract, plus the one the gateway answers itself", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...TOOL_NAMES, AGENT_PROMPT_TOOL.name].sort(),
    );
  });

  it("derives each JSON Schema from the shared zod definition", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (
      body.result as {
        tools: Array<{ name: string; inputSchema: { required?: string[] }; annotations?: unknown }>;
      }
    ).tools;

    const read = tools.find((tool) => tool.name === "read_file");
    expect(read?.inputSchema.required).toEqual(["path"]);
    // readOnlyHint tells a client which tools are safe to call without asking.
    expect(read?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((tool) => tool.name === "run_command")?.annotations).toMatchObject({
      readOnlyHint: false,
    });
  });
});

/**
 * Exeora's own coding-agent guidance, on the three channels that carry it.
 *
 * All three are answered inside the Worker, which is the property worth
 * asserting: an agent that has just connected should be able to read how to
 * behave here before, and regardless of whether, any machine is awake.
 */
describe("the agent prompt", () => {
  it("hands the brief to every client in the handshake", async () => {
    const body = await payload(
      await post({
        jsonrpc: "2.0",
        id: 30,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "inspector", version: "2.1.0" },
        },
      }),
    );

    const result = body.result as { instructions?: string; capabilities?: Record<string, unknown> };

    expect(result.instructions).toContain("PATH_ESCAPE");
    // The per-project endpoint has no project to choose between, so it must not
    // spend the handshake explaining how.
    expect(result.instructions).not.toContain("list_projects");
    // The handshake is also where a client decides whether prompts/list is
    // worth sending. Registering a prompt nobody is told about serves nobody.
    expect(result.capabilities).toHaveProperty("prompts");
  });

  it("offers the full prompt to clients that speak prompts", async () => {
    const listed = await payload(await post({ jsonrpc: "2.0", id: 31, method: "prompts/list" }));
    const prompts = (listed.result as { prompts: Array<{ name: string }> }).prompts;
    expect(prompts.map((prompt) => prompt.name)).toContain(AGENT_PROMPT_NAME);

    const got = await payload(
      await post({
        jsonrpc: "2.0",
        id: 32,
        method: "prompts/get",
        params: { name: AGENT_PROMPT_NAME },
      }),
    );

    const messages = (got.result as { messages: Array<{ content: { text: string } }> }).messages;
    expect(messages[0]?.content.text).toBe(agentPrompt());
  });

  it("serves the same text as a tool, without troubling the executor", async () => {
    let dispatched = false;

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 33,
          method: "tools/call",
          params: { name: AGENT_PROMPT_TOOL.name, arguments: {} },
        },
        {
          dispatch: async () => {
            dispatched = true;
            return {};
          },
        },
      ),
    );

    expect(dispatched).toBe(false);
    expect(body.result).toMatchObject({ structuredContent: { prompt: agentPrompt() } });
  });
});

describe("tools/call", () => {
  it("passes the project id and arguments through to the dispatcher", async () => {
    const seen: Array<{ projectId: string; tool: string; args: unknown }> = [];

    const response = await post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "grep", arguments: { pattern: "TODO" } },
      },
      {
        dispatch: async (context, tool, args) => {
          seen.push({ projectId: context.projectId, tool, args });
          return { matches: [], truncated: false };
        },
      },
    );

    await payload(response);
    expect(seen).toEqual([{ projectId: PROJECT, tool: "grep", args: { pattern: "TODO" } }]);
  });

  it("returns the executor's value as structured content", async () => {
    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "read_file", arguments: { path: "src/main.ts" } },
        },
        {
          dispatch: async () => ({
            path: "src/main.ts",
            content: "hi",
            truncated: false,
            totalLines: 1,
          }),
        },
      ),
    );

    expect(body.result).toMatchObject({
      structuredContent: { path: "src/main.ts", content: "hi" },
    });
  });

  it("surfaces an offline device as an error the agent can read", async () => {
    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "run_command", arguments: { command: "ls" } },
        },
        {
          dispatch: async () => {
            throw new ExeoraError("LOCAL_EXECUTOR_OFFLINE", "No Exeora CLI is connected.");
          },
        },
      ),
    );

    expect(JSON.stringify(body)).toContain("No Exeora CLI is connected");
  });

  it("rejects arguments that do not match the schema before reaching the executor", async () => {
    let dispatched = false;

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          // `path` is required.
          params: { name: "read_file", arguments: {} },
        },
        {
          dispatch: async () => {
            dispatched = true;
            return {};
          },
        },
      ),
    );

    expect(dispatched).toBe(false);
    expect(JSON.stringify(body).toLowerCase()).toMatch(/invalid|required|schema/);
  });
});

describe("caller identity", () => {
  /**
   * The props live on the ExecutionContext, so a handler invoked as
   * `.fetch(request)` receives no user at all. That looks healthy from the
   * outside: the CLI connects, the dashboard lists the project, tools/list
   * answers, and only tools/call fails, with the project lookup finding
   * nothing for the empty user id.
   */
  it("carries the grant's user and client through to the dispatcher", async () => {
    const seen: McpToolContext[] = [];

    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "list_files", arguments: {} },
        },
        {
          props: { userId: "usr_owner", clientId: "cli_chatgpt", clientName: "ChatGPT" },
          dispatch: async (context) => {
            seen.push(context);
            return { path: ".", entries: [], truncated: false };
          },
        },
      ),
    );

    expect(seen).toEqual([
      {
        userId: "usr_owner",
        projectId: PROJECT,
        caller: {
          clientId: "cli_chatgpt",
          clientName: "ChatGPT",
          // No envelope on a 2025-era request: this is the normal case today.
          mcp: undefined,
        },
        // A 2025-era request carries no elicitation answer, so nothing here has
        // been confirmed. Whether that matters is the project's policy to say.
        approved: false,
        // And it cannot be asked over MCP either, which is what sends the
        // question to the machine's terminal or the dashboard instead.
        canElicit: false,
      },
    ]);
  });

  /**
   * The 2026-07-28 revision moved client identity into a per-request `_meta`
   * envelope, which is the only way a stateless endpoint can learn it without
   * having seen the handshake.
   */
  it("reads clientInfo from the per-request envelope when a client sends one", async () => {
    const seen: McpToolContext[] = [];

    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: {
            name: "list_files",
            arguments: {},
            _meta: { [CLIENT_INFO_META_KEY]: { name: "claude-code", version: "2.1.0" } },
          },
        },
        {
          props: { userId: "usr_owner", clientId: "cli_claude" },
          dispatch: async (context) => {
            seen.push(context);
            return { path: ".", entries: [], truncated: false };
          },
        },
      ),
    );

    expect(seen[0]?.caller.mcp).toEqual({ name: "claude-code", version: "2.1.0" });
  });

  /**
   * The era every client speaks today. `initialize` is the only message that
   * carries `clientInfo` there, and it arrives on its own request, so the name
   * has to be read off the wire or lost.
   */
  it("reads clientInfo out of a 2025-era handshake body", async () => {
    const info = await handshakeClientInfo(
      initialize({
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "chatgpt", version: "1.2025.7" },
      }),
    );

    expect(info).toEqual({ name: "chatgpt", version: "1.2025.7" });
  });

  it("ignores anything that is not a handshake", async () => {
    const request = new Request("https://exeora.dev/p/prj_abc/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "a.ts" } },
      }),
    });

    expect(await handshakeClientInfo(request)).toBeUndefined();
  });

  it("skips a body too large to be a handshake, rather than buffering it", async () => {
    const request = initialize({
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "chatgpt", version: "1.2025.7" },
    });
    request.headers.set("Content-Length", String(1024 * 1024));

    expect(await handshakeClientInfo(request)).toBeUndefined();
  });

  it("tolerates a handshake that announces no client at all", async () => {
    const info = await handshakeClientInfo(
      initialize({ protocolVersion: "2025-06-18", capabilities: {} }),
    );

    expect(info).toBeUndefined();
  });
});

describe("per-project routing", () => {
  it("builds a distinct route for each project", () => {
    expect(mcpRoute("prj_a")).toBe("/p/prj_a/mcp");
    expect(mcpRoute("prj_b")).not.toBe(mcpRoute("prj_a"));
  });

  /**
   * The account endpoint adds a `project` argument to every tool. This one must
   * not, and the reason is the whole point of it: the project is in the path,
   * so offering the model a field for naming one would hand back exactly what
   * this endpoint exists to withhold.
   */
  it("offers no way to name a project in a tool's arguments", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (
      body.result as { tools: Array<{ inputSchema: { properties?: Record<string, unknown> } }> }
    ).tools;

    for (const tool of tools) {
      expect(tool.inputSchema.properties ?? {}).not.toHaveProperty("project");
    }
  });

  it("reports the project it was built for, not one taken from the request", async () => {
    const seen: string[] = [];
    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "list_files", arguments: {} },
        },
        {
          project: "prj_other",
          dispatch: async (context) => {
            seen.push(context.projectId);
            return { path: ".", entries: [], truncated: false };
          },
        },
      ),
    );

    expect(seen).toEqual(["prj_other"]);
  });
});

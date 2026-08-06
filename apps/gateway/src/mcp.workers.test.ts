import { createExecutionContext } from "cloudflare:test";
import { ExeoraError, TOOL_NAMES } from "@exeora/protocol";
import { describe, expect, it } from "vitest";
import {
  createProjectMcpHandler,
  type McpToolContext,
  mcpRoute,
  type ToolDispatcher,
} from "./mcp.js";

/**
 * The MCP surface: what an agent actually sees, and what happens to its call
 * on the way to the executor.
 */

const PROJECT = "prj_abc";

function post(
  body: unknown,
  options: { dispatch?: ToolDispatcher; project?: string; props?: Record<string, string> } = {},
) {
  const project = options.project ?? PROJECT;
  const dispatch: ToolDispatcher =
    options.dispatch ?? (async (_context, tool, args) => ({ tool, args }));

  const request = new Request(`https://exeora.dev${mcpRoute(project)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      // The version claude.ai and ChatGPT still speak, so this also proves
      // the legacy compatibility path is live.
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });

  // The (request, env, ctx) form the Worker uses, with the props the OAuth
  // provider attaches to the ExecutionContext after validating the token.
  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = options.props ?? { userId: "usr_test" };

  return createProjectMcpHandler(project, dispatch)(request, {}, ctx);
}

/** Responses may arrive as SSE, so the JSON-RPC payload is dug out either way. */
async function payload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data: ") || candidate.startsWith("{"));
  if (!line) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  return JSON.parse(line.startsWith("data: ") ? line.slice(6) : line);
}

describe("tools/list", () => {
  it("advertises exactly the six tools of the contract", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
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
          props: { userId: "usr_owner", clientId: "cli_chatgpt" },
          dispatch: async (context) => {
            seen.push(context);
            return { path: ".", entries: [], truncated: false };
          },
        },
      ),
    );

    expect(seen).toEqual([{ userId: "usr_owner", projectId: PROJECT, clientId: "cli_chatgpt" }]);
  });
});

describe("per-project routing", () => {
  it("builds a distinct route for each project", () => {
    expect(mcpRoute("prj_a")).toBe("/p/prj_a/mcp");
    expect(mcpRoute("prj_b")).not.toBe(mcpRoute("prj_a"));
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

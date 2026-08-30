import { createExecutionContext } from "cloudflare:test";
import {
  ACCOUNT_TOOL_NAMES,
  AGENT_PROMPT_NAME,
  AGENT_PROMPT_TOOL,
  agentPrompt,
  TOOL_NAMES,
} from "@exeora/protocol";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MCP_ROUTE,
  type AccountCall,
  type AccountDispatcher,
  type AccountToolHandler,
  createAccountMcpHandler,
} from "./mcp-account.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

function post(
  body: unknown,
  options: {
    dispatch?: AccountDispatcher;
    manage?: AccountToolHandler;
    props?: Record<string, string>;
    protocol?: string;
    headers?: Record<string, string>;
    advertised?: ReadonlySet<(typeof TOOL_NAMES)[number]>;
  } = {},
) {
  const dispatch: AccountDispatcher =
    options.dispatch ?? (async (_call, tool, args) => ({ kind: "value", value: { tool, args } }));

  const manage: AccountToolHandler =
    options.manage ?? (async (_call, tool, args) => ({ tool, args }));

  const request = new Request(`https://exeora.dev${ACCOUNT_MCP_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": options.protocol ?? "2025-06-18",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });

  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = options.props ?? {
    userId: "usr_test",
    clientId: "cli_test",
  };

  return createAccountMcpHandler(
    dispatch,
    manage,
    { REQUEST_STATE_SECRET: SECRET },
    options.advertised,
  )(request, {}, ctx);
}

function postModern(
  body: { params: { name: string; arguments?: unknown } } & Record<string, unknown>,
  options: { dispatch?: AccountDispatcher } = {},
) {
  return post(
    {
      ...body,
      params: {
        ...body.params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "inspector", version: "2.1.0" },
          [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} },
        },
      },
    },
    {
      ...options,
      protocol: "2026-07-28",
      headers: { "Mcp-Method": "tools/call", "Mcp-Name": body.params.name },
    },
  );
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data: ") || candidate.startsWith("{"));
  if (!line) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  return JSON.parse(line.startsWith("data: ") ? line.slice(6) : line);
}

function toolsOf(body: Record<string, unknown>) {
  return (body.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
}

describe("tools/list", () => {
  it("offers the executor tools, the project list, and the prompt", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));

    expect(
      toolsOf(body)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...TOOL_NAMES, ...ACCOUNT_TOOL_NAMES, AGENT_PROMPT_TOOL.name].sort());
  });

  it("keeps the gateway's own tools when the executor tools are narrowed", async () => {
    const body = await payload(
      await post(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { advertised: new Set(["read_file"] as const) },
      ),
    );

    expect(
      toolsOf(body)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...ACCOUNT_TOOL_NAMES, AGENT_PROMPT_TOOL.name, "read_file"].sort());
  });

  it("adds an optional project argument to every executor tool", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));

    const schemas = toolsOf(body) as Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown>; required?: string[] };
    }>;

    for (const name of TOOL_NAMES) {
      const tool = schemas.find((candidate) => candidate.name === name);
      expect(tool?.inputSchema.properties).toHaveProperty("project");
      expect(tool?.inputSchema.required ?? []).not.toContain("project");
    }
  });

  it("does not offer it on the tools that are about projects themselves", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));

    const listProjects = toolsOf(body).find((tool) => tool.name === "list_projects") as
      | { inputSchema: { properties?: Record<string, unknown> } }
      | undefined;

    expect(listProjects?.inputSchema.properties ?? {}).not.toHaveProperty("project");
  });

  it("uses lifecycle-specific worktree routing", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const schemas = toolsOf(body) as Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown>; required?: string[] };
    }>;

    expect(
      schemas.find((tool) => tool.name === "create_worktree")?.inputSchema.required ?? [],
    ).not.toContain("worktree");
    expect(
      schemas.find((tool) => tool.name === "remove_worktree")?.inputSchema.required ?? [],
    ).toContain("worktree");
    expect(
      schemas.find((tool) => tool.name === "attach_worktree")?.inputSchema.properties ?? {},
    ).not.toHaveProperty("worktree");
    expect(
      schemas.find((tool) => tool.name === "list_git_worktrees")?.inputSchema.properties ?? {},
    ).not.toHaveProperty("worktree");
  });

  it("does not advertise the retired active-project tools", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const names = toolsOf(body).map((tool) => tool.name);

    expect(names).not.toContain("get_active_project");
    expect(names).not.toContain("set_active_project");
  });
});

describe("the agent prompt", () => {
  it("explains choosing a project, which the per-project endpoint cannot need", async () => {
    const body = await payload(
      await post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "inspector", version: "2.1.0" },
        },
      }),
    );

    const instructions = (body.result as { instructions?: string }).instructions;
    expect(instructions).toContain("every other tool call must name its `project`");
    expect(instructions).toContain("conversations do not move each other");
  });

  it("serves the account variant on both the prompt and the tool", async () => {
    const expected = agentPrompt({ account: true });

    const got = await payload(
      await post({
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/get",
        params: { name: AGENT_PROMPT_NAME },
      }),
    );
    const messages = (got.result as { messages: Array<{ content: { text: string } }> }).messages;
    expect(messages[0]?.content.text).toBe(expected);

    const called = await payload(
      await post({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: AGENT_PROMPT_TOOL.name, arguments: {} },
      }),
    );
    expect(called.result).toMatchObject({ structuredContent: { prompt: expected } });
  });

  /**
   * The one thing that could go wrong quietly. Every other tool here takes a
   * `project`, and a prompt that took one would imply the text differs per
   * project, which it does not.
   */
  it("takes no project argument, having nothing to do with one", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 4, method: "tools/list" }));

    const tool = toolsOf(body).find((candidate) => candidate.name === AGENT_PROMPT_TOOL.name) as
      | { inputSchema: { properties?: Record<string, unknown> } }
      | undefined;

    expect(tool?.inputSchema.properties ?? {}).not.toHaveProperty("project");
  });
});

describe("naming a project on one call", () => {
  const call = (args: unknown) => ({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "read_file", arguments: args },
  });

  it("passes the named project to the dispatcher", async () => {
    const seen: Array<string | undefined> = [];

    await payload(
      await post(call({ path: "a.ts", project: "api" }), {
        dispatch: async (received) => {
          seen.push(received.project);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    expect(seen).toEqual(["api"]);
  });

  it("strips it before the arguments travel, so the executor sees its own schema", async () => {
    const seen: unknown[] = [];

    await payload(
      await post(call({ path: "a.ts", project: "api" }), {
        dispatch: async (_received, _tool, args) => {
          seen.push(args);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    expect(seen).toEqual([{ path: "a.ts" }]);
  });

  it("strips project and required worktree routing from remove_worktree", async () => {
    const seen: Array<{
      project: string | undefined;
      worktree: string | undefined;
      args: unknown;
    }> = [];

    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: {
            name: "remove_worktree",
            arguments: {
              project: "api",
              worktree: "feature-api",
              force: true,
              deleteBranch: false,
            },
          },
        },
        {
          dispatch: async (received, _tool, args) => {
            seen.push({ project: received.project, worktree: received.worktree, args });
            return { kind: "value", value: { outcome: "removed" } };
          },
        },
      ),
    );

    expect(seen).toEqual([
      {
        project: "api",
        worktree: "feature-api",
        args: { force: true, deleteBranch: false },
      },
    ]);
  });

  it("says nothing was named when the call did not name one", async () => {
    const seen: Array<string | undefined> = [];

    await payload(
      await post(call({ path: "a.ts" }), {
        dispatch: async (received) => {
          seen.push(received.project);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    expect(seen).toEqual([undefined]);
  });
});

describe("the caller it reports", () => {
  it("carries the client the token was issued to", async () => {
    const seen: AccountCall[] = [];

    await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_files", arguments: {} },
        },
        {
          props: { userId: "usr_9", clientId: "cli_9", clientName: "Claude" },
          dispatch: async (call) => {
            seen.push(call);
            return { kind: "value", value: {} };
          },
        },
      ),
    );

    expect(seen[0]?.userId).toBe("usr_9");
    expect(seen[0]?.caller.clientId).toBe("cli_9");
    expect(seen[0]?.caller.clientName).toBe("Claude");
  });
});

/**
 * An approval names one project, and is worth nothing anywhere else.
 *
 * The endpoint's job here is to carry the project out of the confirmation and
 * back in on the next round, so whoever resolves the call can compare the two.
 * Without that, a confirmation given for one repository would verify against
 * the same arguments in another.
 */
describe("approval", () => {
  const writeCall = {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "write_file", arguments: { path: "src/main.ts", content: "hi" } },
  };

  it("mints a state bound to the project the dispatcher resolved", async () => {
    const body = await payload(
      await postModern(writeCall, {
        dispatch: async () => ({
          kind: "needs-approval",
          projectId: "prj_resolved",
          project: "api",
        }),
      }),
    );

    const result = body.result as { requestState?: string; inputRequests?: unknown };

    expect(typeof result.requestState).toBe("string");
    expect(result.inputRequests).toBeTruthy();
  });

  // One URL reaches several projects, so a question that only describes the
  // call asks someone to approve a write without saying which repository it
  // lands in.
  it("names the project in the question it asks", async () => {
    const body = await payload(
      await postModern(writeCall, {
        dispatch: async () => ({
          kind: "needs-approval",
          projectId: "prj_resolved",
          project: "api",
        }),
      }),
    );

    expect(JSON.stringify(body.result)).toContain("In api");
  });

  it("reports no approval when the round carries none", async () => {
    const seen: Array<string | undefined> = [];

    await payload(
      await post(writeCall, {
        dispatch: async (call) => {
          seen.push(call.approvedProjectId);
          return { kind: "value", value: {} };
        },
      }),
    );

    expect(seen).toEqual([undefined]);
  });

  it("refuses to ask a client that cannot be asked", async () => {
    const body = await payload(
      await post(writeCall, {
        dispatch: async () => ({
          kind: "needs-approval",
          projectId: "prj_resolved",
          project: "api",
        }),
      }),
    );

    expect(body.error ?? (body.result as { isError?: boolean }).isError).toBeTruthy();
  });
});

describe("the project list", () => {
  it("answers without reaching a dispatcher", async () => {
    let dispatched = false;

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        },
        {
          dispatch: async () => {
            dispatched = true;
            return { kind: "value", value: {} };
          },
          manage: async () => ({ projects: [] }),
        },
      ),
    );

    expect(dispatched).toBe(false);
    expect((body.result as { structuredContent: unknown }).structuredContent).toEqual({
      projects: [],
    });
  });

  it("rejects the retired switch tool as unknown", async () => {
    const body = await payload(
      await post({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "set_active_project", arguments: { project: "api" } },
      }),
    );

    expect(body.error).toBeTruthy();
  });
});

describe("the route", () => {
  it("is the same URL for everyone", () => {
    expect(ACCOUNT_MCP_ROUTE).toBe("/mcp");
  });
});

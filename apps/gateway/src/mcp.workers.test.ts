import { createExecutionContext } from "cloudflare:test";
import { ExeoraError, TOOL_NAMES } from "@exeora/protocol";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { hashArguments } from "./approval.js";
import {
  createProjectMcpHandler,
  handshakeClientInfo,
  isApproved,
  type McpToolContext,
  mcpRoute,
  type ToolDispatcher,
} from "./mcp.js";

/**
 * The MCP surface: what an agent actually sees, and what happens to its call
 * on the way to the executor.
 */

const PROJECT = "prj_abc";

/**
 * A dispatcher as these tests care about it: the value a tool answers with.
 *
 * The real one returns a discriminated result so it can also ask for approval,
 * which none of these tests exercise; wrapping here keeps each of them about
 * the value its tool produced.
 */
type ValueDispatcher = (context: McpToolContext, tool: string, args: unknown) => Promise<unknown>;

function post(
  body: unknown,
  options: {
    dispatch?: ValueDispatcher;
    /** For the approval flow, where the dispatcher's answer is not a value. */
    rawDispatch?: ToolDispatcher;
    project?: string;
    props?: Record<string, string>;
    /** The protocol revision the client claims. Defaults to the 2025 one. */
    protocol?: string;
    /** Extra headers, for the ones the 2026-07-28 wire requires. */
    headers?: Record<string, string>;
  } = {},
) {
  const project = options.project ?? PROJECT;
  const answer: ValueDispatcher =
    options.dispatch ?? (async (_context, tool, args) => ({ tool, args }));

  const dispatch: ToolDispatcher =
    options.rawDispatch ??
    (async (context, tool, args) => ({
      kind: "value",
      value: await answer(context, tool, args),
    }));

  const request = new Request(`https://exeora.dev${mcpRoute(project)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      // The version claude.ai and ChatGPT still speak, so the default here also
      // proves the legacy compatibility path is live.
      "MCP-Protocol-Version": options.protocol ?? "2025-06-18",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });

  // The (request, env, ctx) form the Worker uses, with the props the OAuth
  // provider attaches to the ExecutionContext after validating the token.
  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = options.props ?? { userId: "usr_test" };

  // Any value will do, as long as it clears the codec's 32-byte minimum: the
  // approval tests below assert that a state was minted, never what it says.
  const env = { REQUEST_STATE_SECRET: "test-secret-that-is-at-least-32-bytes-long" };

  return createProjectMcpHandler(project, dispatch, env)(request, {}, ctx);
}

/**
 * The same, as a 2026-07-28 client sends it.
 *
 * That revision is strict about the shape, and all of it is required: the two
 * `Mcp-*` headers must agree with the body, and the per-request envelope must
 * carry the protocol version, the client's identity and its capabilities. A
 * request missing any of them is rejected before a server is ever built, which
 * is why this is a builder rather than a header swapped in the one above.
 */
function postModern(
  body: { params: { name: string; arguments?: unknown } } & Record<string, unknown>,
  options: { rawDispatch?: ToolDispatcher; project?: string } = {},
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

function initialize(params: unknown): Request {
  return new Request("https://exeora.dev/p/prj_abc/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params }),
  });
}

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

/**
 * Asking before a tool runs.
 *
 * The mechanism arrived with MCP 2026-07-28, so the two eras get different
 * answers and both have to be right: a modern client is asked, and a 2025-era
 * one is refused rather than quietly run unconfirmed, which would make the
 * setting decorative for exactly the clients most people use today.
 */
describe("approval", () => {
  const needsApproval: ToolDispatcher = async () => ({
    kind: "needs-approval",
    projectId: PROJECT,
  });

  const writeCall = {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "write_file", arguments: { path: "src/main.ts", content: "hi" } },
  };

  it("asks a client that can be asked", async () => {
    const body = await payload(await postModern(writeCall, { rawDispatch: needsApproval }));

    const result = body.result as {
      resultType?: string;
      inputRequests?: Record<string, { params?: { message?: string } }>;
      requestState?: string;
    };

    expect(result.resultType).toBe("input_required");
    // Named, not just "approve this write": a prompt with nothing in it is one
    // people learn to click through.
    expect(result.inputRequests?.approve?.params?.message).toContain("src/main.ts");
    // The half that joins the two rounds, and the half a client cannot forge.
    expect(typeof result.requestState).toBe("string");
  });

  it("tells the dispatcher when a client cannot be asked over MCP", async () => {
    const seen: boolean[] = [];

    await payload(
      await post(writeCall, {
        rawDispatch: async (context) => {
          seen.push(context.canElicit);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    // A 2025-era client, which is claude.ai and ChatGPT today. The dispatcher
    // asks the machine's terminal or the dashboard instead; this layer only has
    // to say which kind of client it is talking to.
    expect(seen).toEqual([false]);
  });

  it("never answers a 2025-era client with an input_required it cannot read", async () => {
    // The dispatcher is not supposed to ask for a confirmation from a client
    // that cannot give one, so this stub is a bug being simulated. It must
    // surface as an error rather than as a response that looks like a hang.
    const body = await payload(await post(writeCall, { rawDispatch: needsApproval }));

    expect(JSON.stringify(body)).not.toContain("input_required");
  });

  it("tells the dispatcher nothing was confirmed when no answer came back", async () => {
    const seen: boolean[] = [];

    await payload(
      await postModern(writeCall, {
        rawDispatch: async (context) => {
          seen.push(context.approved);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    expect(seen).toEqual([false]);
  });
});

/**
 * The gate that decides whether a confirmation still applies to this call.
 *
 * Exercised directly rather than over the wire, because the wire only reaches
 * it one way and every condition here has to be wrong in the safe direction.
 * The signature is checked before this runs, by the seam; what is left is
 * whether the approval is for the call in hand.
 */
describe("whether a round counts as approved", () => {
  const TOOL = "run_command" as const;
  const ARGS = { command: "ls" };

  /** A round carrying whatever a test wants to put in it. */
  const round = (state: unknown, answer: unknown) =>
    ({
      mcpReq: {
        requestState: () => state,
        inputResponses: answer === undefined ? undefined : { approve: answer },
      },
    }) as never;

  const accepted = (content: unknown) => ({ action: "accept", content });

  it("accepts a signed state that matches the call and a yes", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      true,
    );
  });

  /**
   * The one that matters most. Without comparing the arguments, a client could
   * have `ls` confirmed and retry with `rm -rf ~` carrying the same state: the
   * signature would verify and the tool would match.
   */
  it("refuses a retry that swapped the arguments after approval", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(
      await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, {
        command: "rm -rf ~",
      }),
    ).toBe(false);
  });

  it("refuses a state minted for another tool", async () => {
    const state = { projectId: PROJECT, tool: "write_file", argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
  });

  it("refuses a state minted for another project", async () => {
    const state = { projectId: "prj_elsewhere", tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
  });

  it("refuses a no, a decline and a cancel alike", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: false })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
    expect(await isApproved(round(state, { action: "decline" }), PROJECT, TOOL, ARGS)).toBe(false);
    expect(await isApproved(round(state, { action: "cancel" }), PROJECT, TOOL, ARGS)).toBe(false);
  });

  it("refuses anything but a boolean true", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    // A client answering with a truthy string is not a client that asked a
    // person, and must not be read as one.
    for (const answer of ["true", 1, {}, null]) {
      expect(
        await isApproved(round(state, accepted({ approve: answer })), PROJECT, TOOL, ARGS),
      ).toBe(false);
    }
  });

  it("refuses a round carrying no state at all", async () => {
    expect(
      await isApproved(round(undefined, accepted({ approve: true })), PROJECT, TOOL, ARGS),
    ).toBe(false);
  });

  it("refuses a round carrying state but no answer", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, undefined), PROJECT, TOOL, ARGS)).toBe(false);
  });
});

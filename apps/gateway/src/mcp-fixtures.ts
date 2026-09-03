import { createExecutionContext } from "cloudflare:test";
import type { McpServerTools } from "@exeora/protocol";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import {
  createProjectMcpHandler,
  type McpDispatcher,
  type McpToolContext,
  mcpRoute,
  type ToolDispatcher,
} from "./mcp.js";

/**
 * How the MCP suites send a request and read the answer back.
 *
 * Both eras of the wire are built here rather than in each suite because the
 * 2026-07-28 shape is strict and all of it is required: getting one header or
 * one `_meta` key wrong fails before a server is built, which would look like
 * the behaviour under test rather than the fixture.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
 */

export const PROJECT = "prj_abc";

/**
 * A dispatcher as these tests care about it: the value a tool answers with.
 *
 * The real one returns a discriminated result so it can also ask for approval,
 * which none of these tests exercise; wrapping here keeps each of them about
 * the value its tool produced.
 */
export type ValueDispatcher = (
  context: McpToolContext,
  tool: string,
  args: unknown,
) => Promise<unknown>;

export function post(
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
    /** Downstream MCP servers to republish, and what their calls answer. */
    mcp?: {
      servers: McpServerTools[];
      dispatch?: (
        context: McpToolContext,
        server: string,
        tool: string,
        args: unknown,
        readOnlyHint: boolean | undefined,
      ) => Promise<unknown>;
      /** For the approval flow, where the dispatcher's answer is not a value. */
      rawDispatch?: McpDispatcher;
    };
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

  const mcp =
    options.mcp === undefined
      ? undefined
      : {
          servers: options.mcp.servers,
          dispatch:
            options.mcp.rawDispatch ??
            (async (
              context: McpToolContext,
              server: string,
              tool: string,
              args: unknown,
              readOnlyHint: boolean | undefined,
            ) => ({
              kind: "value" as const,
              value: options.mcp?.dispatch
                ? await options.mcp.dispatch(context, server, tool, args, readOnlyHint)
                : { server, tool, args, readOnlyHint },
            })),
        };

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

  return createProjectMcpHandler(
    project,
    dispatch,
    env,
    undefined,
    undefined,
    mcp,
  )(request, {}, ctx);
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
export function postModern(
  body: { params: { name: string; arguments?: unknown } } & Record<string, unknown>,
  options: Parameters<typeof post>[1] = {},
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
export async function payload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data: ") || candidate.startsWith("{"));
  if (!line) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  return JSON.parse(line.startsWith("data: ") ? line.slice(6) : line);
}

export function initialize(params: unknown): Request {
  return new Request("https://exeora.dev/p/prj_abc/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params }),
  });
}

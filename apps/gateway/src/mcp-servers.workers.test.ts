import { createExecutionContext } from "cloudflare:test";
import type { McpServerTools } from "@exeora/protocol";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MCP_ROUTE,
  type AccountMcpDispatch,
  createAccountMcpHandler,
} from "./mcp-account.js";
import { PROJECT, payload, post, postModern } from "./mcp-fixtures.js";

/**
 * Downstream MCP tools as an agent meets them on the two endpoints: listed
 * under a prefixed name with the server's own schema, called through the same
 * dispatch path as the canonical tools, and confirmed the same way.
 *
 * The relay's half of the same feature is in `relay-do-mcp.workers.test.ts`;
 * this file is what the MCP client at the other end sees.
 */

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

/** The account endpoint's post, carrying an announcement to republish. */
function postAccount(
  body: unknown,
  options: {
    props?: Record<string, string>;
    mcp?: { projectId: string; servers: McpServerTools[]; dispatch?: AccountMcpDispatch };
  } = {},
) {
  const dispatch = options.mcp?.dispatch;

  const request = new Request(`https://exeora.dev${ACCOUNT_MCP_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });

  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = options.props ?? {
    userId: "usr_test",
    clientId: "cli_test",
  };

  return createAccountMcpHandler(
    async () => ({ kind: "value", value: {} }),
    async () => ({}),
    { REQUEST_STATE_SECRET: SECRET },
    undefined,
    options.mcp === undefined
      ? undefined
      : {
          projectId: options.mcp.projectId,
          servers: options.mcp.servers,
          // Omitted stands for "answer with what was asked", the same
          // convention the per-project fixture's dispatch option follows.
          dispatch:
            dispatch ??
            (async (_call, server, tool, args) => ({
              kind: "value" as const,
              value: { server, tool, args },
            })),
        },
  )(request, {}, ctx);
}

describe("the project endpoint", () => {
  const servers = [
    {
      name: "context7",
      status: "ready" as const,
      tools: [
        {
          name: "resolve-library-id",
          title: "Resolve library id",
          description: "Resolve a library name to its context7 id.",
          inputSchema: {
            type: "object",
            properties: { libraryName: { type: "string" } },
            required: ["libraryName"],
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "get-library-docs",
          inputSchema: { type: "object", properties: {} },
          // No annotation: a tool that never claimed to be read only.
        },
      ],
    },
    {
      name: "broken",
      status: "error" as const,
      error: "Exited before the handshake.",
      tools: [
        {
          name: "unreachable",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    },
  ];

  it("lists a configured server's tools under a prefixed name", async () => {
    const body = await payload(
      await post({ jsonrpc: "2.0", id: 40, method: "tools/list" }, { mcp: { servers } }),
    );
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).toContain("mcp__context7__resolve-library-id");
    // A server that announced an error offers none of its tools: an agent that
    // cannot see a broken server does not try it.
    expect(tools.map((tool) => tool.name)).not.toContain("mcp__broken__unreachable");
    expect(tools.map((tool) => tool.name)).not.toContain("resolve-library-id");
  });

  it("carries the server's own schema and read-only claim through", async () => {
    const body = await payload(
      await post({ jsonrpc: "2.0", id: 41, method: "tools/list" }, { mcp: { servers } }),
    );
    const tools = (
      body.result as {
        tools: Array<{
          name: string;
          inputSchema: { required?: string[] };
          annotations?: { readOnlyHint?: boolean };
        }>;
      }
    ).tools;

    const resolve = tools.find((tool) => tool.name === "mcp__context7__resolve-library-id");
    expect(resolve?.inputSchema.required).toEqual(["libraryName"]);
    expect(resolve?.annotations).toMatchObject({ readOnlyHint: true });

    const docs = tools.find((tool) => tool.name === "mcp__context7__get-library-docs");
    // Absent is read as "changes something", never as "harmless".
    expect(docs?.annotations).toMatchObject({ readOnlyHint: false });
  });

  it("routes a call with the server, the tool and the read-only claim", async () => {
    const seen: Array<{
      server: string;
      tool: string;
      args: unknown;
      readOnlyHint: boolean | undefined;
    }> = [];

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: {
            name: "mcp__context7__resolve-library-id",
            arguments: { libraryName: "react" },
          },
        },
        {
          mcp: {
            servers,
            dispatch: async (_context, server, tool, args, readOnlyHint) => {
              seen.push({ server, tool, args, readOnlyHint });
              return { ok: true };
            },
          },
        },
      ),
    );

    expect(seen).toEqual([
      {
        server: "context7",
        tool: "resolve-library-id",
        args: { libraryName: "react" },
        readOnlyHint: true,
      },
    ]);
    // A dispatch value that is not a tool-result shape is JSON-wrapped, the
    // same fallback an older CLI's answer takes.
    expect(body.result).toMatchObject({ structuredContent: { ok: true } });
  });

  it("hands a downstream result back as MCP content, not re-wrapped JSON", async () => {
    const content = [
      { type: "text", text: "react resolves to /react/react" },
      { type: "resource_link", uri: "context7:///react", name: "react" },
    ];

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 43,
          method: "tools/call",
          params: {
            name: "mcp__context7__resolve-library-id",
            arguments: { libraryName: "react" },
          },
        },
        {
          mcp: {
            servers,
            dispatch: async () => ({ content, isError: false }),
          },
        },
      ),
    );

    const result = body.result as { content: unknown; isError?: boolean };
    expect(result.content).toEqual(content);
    expect(result.isError).toBeUndefined();
  });

  it("keeps a downstream isError flag, because the model can read it", async () => {
    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 44,
          method: "tools/call",
          params: { name: "mcp__context7__resolve-library-id", arguments: { libraryName: "" } },
        },
        {
          mcp: {
            servers,
            dispatch: async () => ({
              content: [{ type: "text", text: "the library name was empty" }],
              isError: true,
            }),
          },
        },
      ),
    );

    expect(body.result).toMatchObject({ isError: true });
  });

  it("rejects arguments the downstream schema refuses before any dispatch", async () => {
    let dispatched = false;

    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 45,
          method: "tools/call",
          // No libraryName, which the server's schema requires.
          params: { name: "mcp__context7__resolve-library-id", arguments: {} },
        },
        {
          mcp: {
            servers,
            dispatch: async () => {
              dispatched = true;
              return { ok: true };
            },
          },
        },
      ),
    );

    expect(dispatched).toBe(false);
    // The SDK answers a schema refusal as an isError result the model can
    // read, not as a JSON-RPC error; the native tools' test asserts the same
    // way.
    expect(JSON.stringify(body).toLowerCase()).toMatch(/invalid|required|schema/);
  });

  it("asks before running a tool the server never called read only", async () => {
    const body = await payload(
      await postModern(
        {
          jsonrpc: "2.0",
          id: 46,
          method: "tools/call",
          params: {
            name: "mcp__context7__get-library-docs",
            arguments: { libraryName: "react" },
          },
        },
        {
          mcp: {
            servers,
            rawDispatch: async () => ({ kind: "needs-approval", projectId: PROJECT }),
          },
        },
      ),
    );

    const result = body.result as {
      resultType?: string;
      inputRequests?: Record<string, { params?: { message?: string } }>;
      requestState?: string;
    };

    expect(result.resultType).toBe("input_required");
    expect(result.inputRequests?.approve?.params?.message).toContain("get-library-docs");
    expect(result.inputRequests?.approve?.params?.message).toContain("context7");
    expect(typeof result.requestState).toBe("string");
  });
});

describe("the account endpoint", () => {
  const servers: McpServerTools[] = [
    {
      name: "context7",
      status: "ready",
      tools: [
        {
          name: "resolve-library-id",
          inputSchema: {
            type: "object",
            properties: { libraryName: { type: "string" } },
            required: ["libraryName"],
          },
          annotations: { readOnlyHint: true },
        },
      ],
    },
  ];

  it("lists the one reachable project's servers under a prefixed name", async () => {
    const body = await payload(
      await postAccount(
        { jsonrpc: "2.0", id: 50, method: "tools/list" },
        { mcp: { projectId: "prj_only", servers } },
      ),
    );
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).toContain("mcp__context7__resolve-library-id");
  });

  it("offers none without an announcement to offer", async () => {
    const body = await payload(await postAccount({ jsonrpc: "2.0", id: 51, method: "tools/list" }));
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).not.toContain("mcp__context7__resolve-library-id");
  });

  it("runs a call through the dispatcher it was given", async () => {
    const seen: Array<{ server: string; tool: string; args: unknown }> = [];

    const body = await payload(
      await postAccount(
        {
          jsonrpc: "2.0",
          id: 52,
          method: "tools/call",
          params: {
            name: "mcp__context7__resolve-library-id",
            arguments: { libraryName: "react" },
          },
        },
        {
          mcp: {
            projectId: "prj_only",
            servers,
            dispatch: async (_call, server, tool, args) => {
              seen.push({ server, tool, args });
              return { kind: "value", value: { content: [{ type: "text", text: "found" }] } };
            },
          },
        },
      ),
    );

    expect(seen).toEqual([
      { server: "context7", tool: "resolve-library-id", args: { libraryName: "react" } },
    ]);
    expect(body.result).toMatchObject({ content: [{ type: "text", text: "found" }] });
  });
});

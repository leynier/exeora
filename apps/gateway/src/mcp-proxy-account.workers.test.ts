import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ACCOUNT_MCP_ROUTE, createAccountMcpHandler } from "./mcp-account.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const NAME = "mcp__search__query";
const catalogs = [
  {
    projectId: "prj_alpha",
    project: "alpha",
    tools: [
      {
        exposedName: NAME,
        server: "search",
        name: "query",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
  },
  {
    projectId: "prj_beta",
    project: "beta",
    tools: [
      {
        exposedName: NAME,
        server: "search",
        name: "query",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "number" } },
          required: ["query"],
        },
      },
    ],
  },
];

function post(body: unknown, seen: Array<Record<string, unknown>> = []) {
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
  (ctx as { props?: Record<string, string> }).props = {
    userId: "usr_test",
    clientId: "cli_test",
  };
  const handler = createAccountMcpHandler(
    async () => ({ kind: "value", value: {} }),
    async () => ({}),
    { REQUEST_STATE_SECRET: SECRET },
    new Set(),
    {
      catalogs,
      dispatch: async (call, exposedName, args) => {
        seen.push({
          projectId: call.projectId,
          workspace: call.workspace,
          exposedName,
          args,
        });
        return { content: [{ type: "text", text: "proxied" }] };
      },
    },
  );
  return handler(request, {}, ctx);
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data: ") || candidate.startsWith("{"));
  if (!line) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  return JSON.parse(line.startsWith("data: ") ? line.slice(6) : line);
}

describe("account MCP proxy tools", () => {
  it("requires a project when the same upstream tool exists in several projects", async () => {
    const body = await payload(await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (
      body.result as {
        tools: Array<{ name: string; inputSchema: { oneOf?: Array<Record<string, unknown>> } }>;
      }
    ).tools;
    const proxied = tools.find((tool) => tool.name === NAME);
    const branches = proxied?.inputSchema.oneOf ?? [];

    expect(branches).toHaveLength(2);
    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: expect.arrayContaining(["query", "project"]),
          properties: expect.objectContaining({
            project: expect.objectContaining({ enum: ["alpha"] }),
          }),
        }),
        expect.objectContaining({
          required: expect.arrayContaining(["query", "project"]),
          properties: expect.objectContaining({
            project: expect.objectContaining({ enum: ["beta"] }),
          }),
        }),
      ]),
    );
  });

  it("routes the selected project and removes account routing fields upstream", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const body = await payload(
      await post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: NAME,
            arguments: { project: "beta", workspace: "feature", query: "MCP", limit: 3 },
          },
        },
        seen,
      ),
    );

    expect(seen).toEqual([
      {
        projectId: "prj_beta",
        workspace: "feature",
        exposedName: NAME,
        args: { query: "MCP", limit: 3 },
      },
    ]);
    expect(body.result).toMatchObject({ content: [{ type: "text", text: "proxied" }] });
  });
});

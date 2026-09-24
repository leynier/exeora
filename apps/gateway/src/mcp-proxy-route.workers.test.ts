import { createExecutionContext, env } from "cloudflare:test";
import {
  BASELINE_CAPABILITIES,
  type CommandPolicy,
  DEFAULT_POLICY,
  type McpToolDescriptor,
} from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db/client.js";
import { authenticated } from "./index.js";
import { payload } from "./mcp-fixtures.js";
import {
  attachFakeExecutor,
  currentDeviceId,
  eventually,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";
import { decodeMcpCatalogs } from "./relay-mcp.js";

/**
 * Proxied MCP tools through the real route, from the Worker's authenticated
 * handler to a fake CLI and back.
 *
 * The endpoint tests build a handler with the catalog handed in. This suite is
 * what proves the route loads that catalog on a `tools/call`, which is the
 * half a handler-level test cannot see.
 */

const USER_ID = "usr_test";
const PROJECT_ID = "prj_test";

const WRITE: McpToolDescriptor = {
  exposedName: "mcp__demo__create",
  server: "demo",
  name: "create",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
};
const READ: McpToolDescriptor = {
  exposedName: "mcp__demo__search",
  server: "demo",
  name: "search",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  annotations: { readOnlyHint: true },
};

const CAPABILITIES = {
  ...BASELINE_CAPABILITIES,
  prompt: true,
  features: ["mcp-proxy-v1"],
  workspaceRouting: true,
};

beforeEach(freshRelay);

async function seed(policy: CommandPolicy = DEFAULT_POLICY, answerApproval?: boolean) {
  await db(env)
    .insert(schema.users)
    .values({ id: USER_ID, email: "mcp-proxy-route@example.com" })
    .onConflictDoNothing()
    .run();
  await db(env)
    .insert(schema.devices)
    .values({ id: currentDeviceId(), userId: USER_ID, name: "proxy machine", platform: "linux" })
    .onConflictDoNothing()
    .run();
  const values = {
    id: PROJECT_ID,
    userId: USER_ID,
    deviceId: currentDeviceId(),
    name: "Proxy",
    slug: "proxy",
    localPath: "/work/proxy",
    commandPolicy: JSON.stringify(policy),
  };
  await db(env)
    .insert(schema.projects)
    .values(values)
    .onConflictDoUpdate({ target: schema.projects.id, set: values })
    .run();

  const executor = await attachFakeExecutor({
    capabilities: CAPABILITIES,
    ...(answerApproval === undefined ? {} : { answerApproval }),
    mcpCatalog: [WRITE, READ],
    mcpRespond: (call) => ({
      ok: true,
      value: { content: [{ type: "text", text: `ran ${call.tool}` }] },
    }),
  });
  await executor.ack;
  await eventually(async () => {
    expect(decodeMcpCatalogs(await relay().mcpCatalogs([PROJECT_ID]))[PROJECT_ID]).toHaveLength(2);
  });
  return executor;
}

function call(name: string, args: Record<string, unknown>) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const context = createExecutionContext();
  (context as { props?: Record<string, unknown> }).props = {
    userId: USER_ID,
    scopes: ["tools:read", "tools:execute"],
  };
  return authenticated.fetch(
    new Request(`https://exeora.dev/p/${PROJECT_ID}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(body).byteLength),
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body,
    }),
    env,
    context,
  );
}

describe("proxied MCP tools through the project route", () => {
  it("loads the catalog for a tools/call and runs the upstream tool", async () => {
    const executor = await seed();
    const body = await payload(await call(WRITE.exposedName, { title: "hello" }));

    expect(body.result).toMatchObject({ content: [{ type: "text", text: "ran create" }] });
    expect(executor.mcpSeen).toMatchObject([
      { server: "demo", tool: "create", args: { title: "hello" }, policy: DEFAULT_POLICY },
    ]);
  });

  it("refuses a tool without readOnlyHint in a read-only project", async () => {
    const executor = await seed({ ...DEFAULT_POLICY, mode: "read_only" });
    const body = await payload(await call(WRITE.exposedName, { title: "hello" }));

    expect(JSON.stringify(body)).toContain("read only");
    expect(executor.mcpSeen).toEqual([]);
  });

  it("still runs a read-only upstream tool in a read-only project", async () => {
    const executor = await seed({ ...DEFAULT_POLICY, mode: "read_only" });
    const body = await payload(await call(READ.exposedName, { query: "x" }));

    expect(body.result).toMatchObject({ content: [{ type: "text", text: "ran search" }] });
    expect(executor.mcpSeen).toHaveLength(1);
  });

  it("asks the machine to confirm a tool without readOnlyHint when approval is on", async () => {
    const executor = await seed({ ...DEFAULT_POLICY, approve: true }, true);
    const body = await payload(await call(WRITE.exposedName, { title: "hello" }));

    expect(body.result).toMatchObject({ content: [{ type: "text", text: "ran create" }] });
    expect(executor.asked).toHaveLength(1);
    const question = executor.asked[0];
    expect(question?.tool).toBe(WRITE.exposedName);
    expect(question?.prompt).toContain("`create` from the `demo` MCP server");
    expect(question?.prompt).toContain('{"title":"hello"}');
  });

  it("does not run a tool the machine declined", async () => {
    const executor = await seed({ ...DEFAULT_POLICY, approve: true }, false);
    const body = await payload(await call(WRITE.exposedName, { title: "hello" }));

    expect(JSON.stringify(body)).toContain("not approved");
    expect(executor.mcpSeen).toEqual([]);
  });

  it("does not ask before a read-only upstream tool", async () => {
    const executor = await seed({ ...DEFAULT_POLICY, approve: true });
    const body = await payload(await call(READ.exposedName, { query: "x" }));

    expect(body.result).toMatchObject({ content: [{ type: "text", text: "ran search" }] });
    expect(executor.asked).toEqual([]);
  });
});

import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api/index.js";
import {
  grantedScopes,
  hasEveryScope,
  hasScope,
  inspectMcpAccess,
  insufficientScope,
  isExecutorApiRequest,
} from "./scopes.js";

beforeEach(async () => {
  await Promise.all([
    env.OAUTH_KV.delete("dashboard_client_id"),
    env.OAUTH_KV.delete("cli_client_id"),
  ]);
});

describe("OAuth scope ceilings", () => {
  it("never grants first-party privileges to a third-party MCP client", async () => {
    expect(
      await grantedScopes(env, {
        clientId: "third_party",
        scope: ["dashboard:manage", "executor:connect", "tools:read", "tools:execute"],
      }),
    ).toEqual(["tools:read", "tools:execute"]);
  });

  it("enforces the executor API allowlist at the router boundary", async () => {
    async function call(path: string, scopes: string[]) {
      const context = createExecutionContext();
      (context as { props?: { userId: string; scopes: string[] } }).props = {
        userId: "usr_scope_test",
        scopes,
      };
      return api.fetch(new Request(`https://exeora.dev${path}`), env, context);
    }

    expect((await call("/api/devices", ["executor:connect"])).status).toBe(200);
    expect((await call("/api/clients", ["executor:connect"])).status).toBe(403);
    expect((await call("/api/clients", ["dashboard:manage"])).status).toBe(200);
  });

  it("grants only the scopes requested within each first-party client ceiling", async () => {
    await env.OAUTH_KV.put("dashboard_client_id", "dashboard");
    await env.OAUTH_KV.put("cli_client_id", "cli");

    expect(
      await grantedScopes(env, {
        clientId: "dashboard",
        scope: ["dashboard:manage", "tools:execute"],
      }),
    ).toEqual(["dashboard:manage"]);
    expect(
      await grantedScopes(env, {
        clientId: "cli",
        scope: ["executor:connect", "executor:execute", "tools:read"],
      }),
    ).toEqual(["executor:connect", "executor:execute"]);
  });

  it("fails closed when token props carry no effective scopes", async () => {
    expect(hasScope({}, "tools:read")).toBe(false);
    expect(
      hasEveryScope({ scopes: ["executor:connect"] }, ["executor:connect", "executor:execute"]),
    ).toBe(false);

    const response = insufficientScope(["tools:read"]);
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="tools:read"');
  });

  it("limits executor tokens to the API routes used by the native CLI", () => {
    expect(isExecutorApiRequest("GET", "/api/me")).toBe(true);
    expect(isExecutorApiRequest("GET", "/api/relay/dev_one")).toBe(true);
    expect(isExecutorApiRequest("POST", "/api/devices")).toBe(true);
    expect(isExecutorApiRequest("DELETE", "/api/projects/prj_one")).toBe(true);

    expect(isExecutorApiRequest("DELETE", "/api/me")).toBe(false);
    expect(isExecutorApiRequest("DELETE", "/api/devices/dev_one")).toBe(false);
    expect(isExecutorApiRequest("PUT", "/api/projects/prj_one/policy")).toBe(false);
    expect(isExecutorApiRequest("GET", "/api/admin/users")).toBe(false);
  });

  it("requires execute for tool calls, unknown large posts and protocol mismatches", async () => {
    const legacyCall = new Request("https://exeora.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call" }),
    });
    expect((await inspectMcpAccess(legacyCall)).required).toBe("tools:execute");

    const tooLargeToPeek = new Request("https://exeora.dev/mcp", {
      method: "POST",
      headers: { "content-length": "65537" },
      body: "{}",
    });
    expect((await inspectMcpAccess(tooLargeToPeek)).required).toBe("tools:execute");

    const mismatchBody = JSON.stringify({ jsonrpc: "2.0", method: "tools/call" });
    const mismatch = new Request("https://exeora.dev/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(mismatchBody).byteLength),
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: mismatchBody,
    });
    expect((await inspectMcpAccess(mismatch)).required).toBe("tools:execute");
  });
});

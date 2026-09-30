import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { setSession } from "./session.js";

/**
 * A token reaches what its consent screen named, and nothing else.
 *
 * Run through the whole worker rather than against the parser, because the
 * binding is made of three parts that each look right alone: the screen reads
 * the `resource` parameter, the provider turns it into the token's audience,
 * and `/p/:id/mcp` trusts that audience instead of a `project_clients` row.
 * What is tested here is that they cannot be made to disagree.
 */

const OWNER = "usr_binding_owner";
const PROJECT_A = "prj_binding_visible";
const PROJECT_B = "prj_binding_hidden";
const BASE = "https://exeora.dev";
const CALLBACK = "https://client.example/callback";
const LOOPBACK = "http://127.0.0.1/callback";
const VERIFIER = "a".repeat(64);
const MCP_SCOPE = "tools:read tools:execute";
const bindings = {
  ...env,
  EXEORA_BASE_URL: BASE,
  COOKIE_SECRET: "binding-cookie-secret-only-for-local-tests",
  REQUEST_STATE_SECRET: "binding-request-secret-only-for-local-tests",
  GITHUB_CLIENT_ID: "binding-github-client",
  GITHUB_CLIENT_SECRET: "binding-github-secret",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  RL_AUTH: undefined,
  RL_MCP_READ: undefined,
  RL_MCP_EXECUTE: undefined,
} as unknown as Env;

const sessions = new Hono<{ Bindings: Env }>().get("/set/:userId", async (c) => {
  await setSession(c, c.req.param("userId"));
  return c.text("ok");
});

async function fetchWorker(path: string | URL, init?: RequestInit) {
  const ctx = createExecutionContext();
  const result = await worker.fetch(new Request(new URL(path, BASE), init), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

async function ownerCookie() {
  const response = await sessions.request(`/set/${OWNER}`, {}, bindings);
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("missing session cookie");
  return value.split(";")[0] ?? "";
}

async function register(redirectUri = CALLBACK) {
  const response = await fetchWorker("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "Binding Client",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** The consent screen a signed-in owner gets for this request, or the refusal. */
async function authorize(
  clientId: string,
  resources: string[],
  options: { scope?: string; redirectUri?: string } = {},
) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("/oauth/authorize", BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", options.redirectUri ?? CALLBACK);
  url.searchParams.set("scope", options.scope ?? MCP_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "client-state");
  for (const resource of resources) url.searchParams.append("resource", resource);

  const cookie = await ownerCookie();
  const response = await fetchWorker(url, { headers: { cookie } });
  const html = await response.text();
  return { status: response.status, html, cookie };
}

/** Approves the screen and returns the code the client would receive. */
async function approve(screen: { html: string; cookie: string }, fields: Record<string, string>) {
  const state = /name="state" value="([^"]+)"/.exec(screen.html)?.[1];
  if (!state) throw new Error("the screen carries no approval form");
  const approved = await fetchWorker("/oauth/approve", {
    method: "POST",
    headers: { cookie: screen.cookie, Origin: BASE },
    body: new URLSearchParams({ state, decision: "approve", ...fields }),
  });
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("Location") ?? "").searchParams.get("code");
  if (!code) throw new Error("the approval minted no code");
  return code;
}

function exchange(clientId: string, code: string, extra: Record<string, string> = {}) {
  return fetchWorker("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code,
      code_verifier: VERIFIER,
      ...extra,
    }),
  });
}

async function listWorkspaces(path: string, accessToken: string) {
  const response = await fetchWorker(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    }),
  });
  return { status: response.status, text: await response.text() };
}

beforeEach(async () => {
  await db(env)
    .delete(schema.users)
    .where(inArray(schema.users.id, [OWNER]))
    .run();
  await db(env)
    .insert(schema.users)
    .values({ id: OWNER, email: "binding-owner@example.com" })
    .run();
  await db(env)
    .insert(schema.devices)
    .values({ id: "dev_binding", userId: OWNER, name: "binding-machine", platform: "linux" })
    .run();
  await db(env)
    .insert(schema.projects)
    .values([
      {
        id: PROJECT_A,
        userId: OWNER,
        deviceId: "dev_binding",
        name: "Visible Project",
        slug: "binding-visible",
        localPath: "/binding/visible",
      },
      {
        id: PROJECT_B,
        userId: OWNER,
        deviceId: "dev_binding",
        name: "Hidden Project",
        slug: "binding-hidden",
        localPath: "/binding/hidden",
      },
    ])
    .run();
});

afterEach(async () => {
  await env.OAUTH_KV.delete("cli_client_id");
});

describe("a project token", () => {
  it("reaches the project its screen named and no other", async () => {
    const clientId = await register();
    const screen = await authorize(clientId, [`${BASE}/p/${PROJECT_A}/mcp`]);
    expect(screen.status, screen.html).toBe(200);
    expect(screen.html).toContain("Visible Project");
    expect(screen.html).not.toContain("Hidden Project");

    const exchanged = await exchange(clientId, await approve(screen, {}));
    const token = (await exchanged.json()) as { access_token: string; scope: string };
    expect(exchanged.status, JSON.stringify(token)).toBe(200);
    expect(token.scope).toBe(MCP_SCOPE);

    expect((await listWorkspaces(`/p/${PROJECT_A}/mcp`, token.access_token)).status).toBe(200);
    expect((await listWorkspaces(`/p/${PROJECT_B}/mcp`, token.access_token)).status).toBe(401);
    expect((await listWorkspaces("/mcp", token.access_token)).status).toBe(401);
  });

  it("cannot be widened when the code is exchanged", async () => {
    const clientId = await register();
    const screen = await authorize(clientId, [`${BASE}/p/${PROJECT_A}/mcp`]);
    const exchanged = await exchange(clientId, await approve(screen, {}), {
      resource: `${BASE}/p/${PROJECT_B}/mcp`,
    });
    expect(exchanged.status).toBe(400);
    expect(((await exchanged.json()) as { error: string }).error).toBe("invalid_target");
  });
});

describe("an account token", () => {
  it("reaches what was ticked, and is refused at a project's own URL", async () => {
    const clientId = await register();
    const screen = await authorize(clientId, [`${BASE}/mcp`]);
    expect(screen.status, screen.html).toBe(200);
    expect(screen.html).toContain("Visible Project");
    expect(screen.html).toContain("Hidden Project");

    const code = await approve(screen, { access: "chosen", project: PROJECT_A });
    const exchanged = await exchange(clientId, code);
    const token = (await exchanged.json()) as { access_token: string };
    expect(exchanged.status, JSON.stringify(token)).toBe(200);

    expect((await listWorkspaces("/mcp", token.access_token)).status).toBe(200);
    expect((await listWorkspaces(`/p/${PROJECT_A}/mcp`, token.access_token)).status).toBe(401);
    expect((await listWorkspaces(`/p/${PROJECT_B}/mcp`, token.access_token)).status).toBe(401);
  });
});

// Each of these used to reach the consent screen, show at most one project and
// mint a token that ran commands in every project of the account.
describe("a request that names no single endpoint", () => {
  const wider: Array<[string, string[]]> = [
    ["two projects", [`${BASE}/p/${PROJECT_A}/mcp`, `${BASE}/p/${PROJECT_B}/mcp`]],
    ["a project and the origin", [`${BASE}/p/${PROJECT_A}/mcp`, BASE]],
    ["a project and the account", [`${BASE}/p/${PROJECT_A}/mcp`, `${BASE}/mcp`]],
    ["the origin alone", [BASE]],
    ["the prefix every project shares", [`${BASE}/p`]],
    ["no resource at all", []],
  ];

  for (const [name, resources] of wider) {
    it(`is refused before any screen is shown: ${name}`, async () => {
      const screen = await authorize(await register(), resources);
      expect(screen.status).toBe(400);
      expect(screen.html).not.toContain('action="/oauth/approve"');
      expect(screen.html).not.toContain("Visible Project");
      expect(screen.html).not.toContain("Hidden Project");
    });
  }

  it("is refused for a signed-out visitor too, before the sign-in page", async () => {
    const url = new URL("/oauth/authorize", BASE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", await register());
    url.searchParams.set("redirect_uri", CALLBACK);
    url.searchParams.set("scope", MCP_SCOPE);
    url.searchParams.set("code_challenge", "b".repeat(43));
    url.searchParams.set("code_challenge_method", "S256");
    const response = await fetchWorker(url);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("/oauth/login/");
  });
});

describe("Exeora's own CLI", () => {
  // It sends no resource and receives no MCP scope, so there is no audience to
  // bind and nothing at `/p/:id/mcp` its token could do.
  it("still signs in without a resource, and its token cannot call a tool", async () => {
    const clientId = await register(LOOPBACK);
    await env.OAUTH_KV.put("cli_client_id", clientId);

    const screen = await authorize(clientId, [], {
      scope: `executor:connect executor:execute ${MCP_SCOPE}`,
      redirectUri: LOOPBACK,
    });
    expect(screen.status, screen.html).toBe(200);

    const exchanged = await exchange(clientId, await approve(screen, {}), {
      redirect_uri: LOOPBACK,
    });
    const token = (await exchanged.json()) as { access_token: string; scope: string };
    expect(exchanged.status, JSON.stringify(token)).toBe(200);
    expect(token.scope).toBe("executor:connect executor:execute");
    expect((await listWorkspaces(`/p/${PROJECT_A}/mcp`, token.access_token)).status).toBe(403);
  });
});

import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { github } from "./providers/github.js";
import { getSessionUserId, setSession } from "./session.js";

/**
 * A sign-in flow is bound to the browser its state was born in.
 *
 * The parked state is minted when /oauth/authorize (or the device-code form)
 * renders the sign-in page, and the cookie that goes with it is minted in the
 * same response. Neither /oauth/login nor the callback ever issues it, so a
 * state that travelled by URL, pasted into a link or a message, finds no
 * cookie in the browser it lands in: the upstream round trip cannot be
 * started, and a copied callback URL cannot install whichever upstream account
 * supplied its code as the visitor's session.
 */

const OWNER = "usr_audit_owner";
const ATTACKER = "usr_audit_attacker";
const BASE = "https://exeora.dev";
const CALLBACK = "https://client.example/callback";
const VERIFIER = "a".repeat(64);
const bindings = {
  ...env,
  EXEORA_BASE_URL: BASE,
  COOKIE_SECRET: "audit-cookie-secret-only-for-local-tests",
  REQUEST_STATE_SECRET: "audit-request-secret-only-for-local-tests",
  GITHUB_CLIENT_ID: "audit-github-client",
  GITHUB_CLIENT_SECRET: "audit-github-secret",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  RL_AUTH: undefined,
  RL_MCP_READ: undefined,
  RL_MCP_EXECUTE: undefined,
} as unknown as Env;

const sessions = new Hono<{ Bindings: Env }>()
  .get("/set/:userId", async (c) => {
    await setSession(c, c.req.param("userId"));
    return c.text("ok");
  })
  .get("/who", async (c) => c.text((await getSessionUserId(c)) ?? "anonymous"));

async function fetchWorker(path: string | URL, init?: RequestInit) {
  const ctx = createExecutionContext();
  const result = await worker.fetch(new Request(new URL(path, BASE), init), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

function cookieOf(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("missing session cookie");
  return value.split(";")[0] ?? "";
}

async function sessionOf(userId: string) {
  return cookieOf(await sessions.request(`/set/${userId}`, {}, bindings));
}

async function register() {
  const response = await fetchWorker("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [CALLBACK],
      client_name: "Audit Client",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

async function authorizationUrl(clientId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("/oauth/authorize", BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", CALLBACK);
  url.searchParams.set("scope", "tools:read tools:execute");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "client-state");
  url.searchParams.set("resource", `${BASE}/mcp`);
  return url;
}

/**
 * The attacker's own authorize visit: parks a state and renders a sign-in page
 * whose links carry it. The response also sets the attacker's own continuation
 * cookie, which the attacker's browser keeps and no other browser ever sees.
 */
async function parkedByAttacker(): Promise<string> {
  const clientId = await register();
  const signIn = await fetchWorker(await authorizationUrl(clientId));
  expect(signIn.status).toBe(200);
  const state = /\/oauth\/login\/github\?state=([^"&]+)/.exec(await signIn.text())?.[1] ?? "";
  expect(state).toBeTruthy();
  return state;
}

function attackerUpstream() {
  const exchange = vi.spyOn(github, "exchangeCode").mockResolvedValue("simulated-upstream-token");
  vi.spyOn(github, "fetchIdentity").mockResolvedValue({
    providerUserId: "audit-attacker-github-id",
    email: "audit-attacker@example.com",
    name: "Audit Attacker",
    avatarUrl: null,
  });
  return exchange;
}

beforeEach(async () => {
  await db(env)
    .delete(schema.users)
    .where(inArray(schema.users.id, [OWNER, ATTACKER]))
    .run();
  await db(env)
    .insert(schema.users)
    .values([
      { id: OWNER, email: "audit-owner@example.com" },
      { id: ATTACKER, email: "audit-attacker@example.com" },
    ])
    .run();
});

afterEach(() => vi.restoreAllMocks());

describe("the sign-in flow is bound to the browser its state was born in", () => {
  it("never issues the continuation cookie from a state in a URL", async () => {
    const state = await parkedByAttacker();

    const login = await fetchWorker(`/oauth/login/github?state=${state}`);

    expect(login.status).toBe(400);
    expect(login.headers.get("set-cookie")).toBeNull();
  });

  it("refuses the two-navigation attack, session intact and code unexchanged", async () => {
    const state = await parkedByAttacker();
    const exchange = attackerUpstream();
    const ownerCookie = await sessionOf(OWNER);

    // Navigation one: mint the cookie for the attacker's state. It cannot be
    // minted, as above. Navigation two: finish anyway, with the attacker's
    // upstream code.
    const login = await fetchWorker(`/oauth/login/github?state=${state}`, {
      headers: { cookie: ownerCookie },
    });
    expect(login.status).toBe(400);
    const callback = await fetchWorker(`/oauth/callback/github?state=${state}&code=attacker-code`, {
      headers: { cookie: ownerCookie },
    });

    expect(callback.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    const who = await sessions.request("/who", { headers: { cookie: ownerCookie } }, bindings);
    expect(await who.text()).toBe(OWNER);
  });

  it("completes authorize, login and callback in the browser that started", async () => {
    const clientId = await register();
    attackerUpstream();

    // This browser's own authorize visit: the state and its cookie are born in
    // the same response.
    const signIn = await fetchWorker(await authorizationUrl(clientId));
    const state = /\/oauth\/login\/github\?state=([^"&]+)/.exec(await signIn.text())?.[1] ?? "";
    const continuation = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(continuation).toMatch(/^exeora_signin_/);

    const login = await fetchWorker(`/oauth/login/github?state=${state}`, {
      headers: { cookie: continuation },
    });
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toMatch(/^https:\/\/github\.com/);

    const callback = await fetchWorker(`/oauth/callback/github?state=${state}&code=attacker-code`, {
      headers: { cookie: continuation },
    });

    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).toContain("audit-attacker@example.com");
    // The screen says where the result will be delivered, before the decision.
    expect(html).toContain("Delivers its result to");
    expect(html).toContain(CALLBACK);
    const who = await sessions.request(
      "/who",
      { headers: { cookie: cookieOf(callback) } },
      bindings,
    );
    expect(await who.text()).toBe(ATTACKER);
  });

  it("expires the continuation cookie when the request is answered", async () => {
    const clientId = await register();
    attackerUpstream();
    const signIn = await fetchWorker(await authorizationUrl(clientId));
    const html = await signIn.text();
    const state = /\/oauth\/login\/github\?state=([^"&]+)/.exec(html)?.[1] ?? "";
    const continuation = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";

    await fetchWorker(`/oauth/login/github?state=${state}`, {
      headers: { cookie: continuation },
    });
    const callback = await fetchWorker(`/oauth/callback/github?state=${state}&code=attacker-code`, {
      headers: { cookie: continuation },
    });
    // The consent form under the same state, then approved. The request names
    // the account endpoint, so the answer is the project picker's "all".
    const formState = /name="state" value="([^"]+)"/.exec(await callback.text())?.[1] ?? "";
    const sessionCookie = cookieOf(callback);
    const approved = await fetchWorker("/oauth/approve", {
      method: "POST",
      headers: { cookie: `${sessionCookie}; ${continuation}`, Origin: BASE },
      body: new URLSearchParams({ state: formState, decision: "approve", access: "all" }),
    });

    expect(approved.status).toBe(302);
    const cleared = approved.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/exeora_signin_[a-zA-Z0-9_-]+=;.*Max-Age=0/i);
  });
});

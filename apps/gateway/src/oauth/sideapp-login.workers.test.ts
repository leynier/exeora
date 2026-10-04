import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { base64Url } from "./device.js";
import { setSession } from "./session.js";

const base = "https://exeora.dev";
const sandbox = "https://exeora.web-sandbox.oaiusercontent.com";
const owner = "usr_sideapp_login";
const verifier = "a".repeat(64);
const bindings = {
  ...env,
  EXEORA_BASE_URL: base,
  COOKIE_SECRET: "sideapp-login-cookie-secret-only-for-tests",
  REQUEST_STATE_SECRET: "sideapp-login-state-secret-only-for-tests",
  GITHUB_CLIENT_ID: "sideapp-test-github",
  GITHUB_CLIENT_SECRET: "sideapp-test-secret",
  RL_AUTH: undefined,
} as unknown as Env;

const sessions = new Hono<{ Bindings: Env }>().get("/session", async (c) => {
  await setSession(c, owner);
  return c.text("ok");
});
async function fetchWorker(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(new URL(path, base), init), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

beforeEach(async () => {
  await db(env).delete(schema.users).where(eq(schema.users.id, owner));
  await db(env).insert(schema.users).values({ id: owner, email: "sideapp-login@example.com" });
});

async function authorize(decision: "approve" | "deny") {
  const discovery = await fetchWorker("/oauth/sideapp-client");
  const { client_id } = (await discovery.json()) as { client_id: string };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const start = await fetchWorker("/oauth/device/code", {
    method: "POST",
    headers: { Origin: sandbox },
    body: new URLSearchParams({
      client_id,
      scope: "dashboard:manage",
      code_challenge: base64Url(new Uint8Array(digest)),
      code_challenge_method: "S256",
    }),
  });
  expect(start.status).toBe(200);
  const { device_code, user_code } = (await start.json()) as {
    device_code: string;
    user_code: string;
  };
  const session = cookies(await sessions.request("/session", {}, bindings));
  const consent = await fetchWorker("/oauth/device", {
    method: "POST",
    headers: { Origin: base, Cookie: session },
    body: new URLSearchParams({ user_code }),
  });
  expect(consent.status).toBe(200);
  const html = await consent.text();
  expect(html).toContain("dashboard:manage");
  const state = /name="state" value="([^"]+)"/.exec(html)?.[1];
  if (!state) throw new Error("missing consent form");
  const approved = await fetchWorker("/oauth/approve", {
    method: "POST",
    headers: { Origin: base, Cookie: `${session}; ${cookies(consent)}` },
    body: new URLSearchParams({ state, decision }),
  });
  expect(approved.status).toBe(200);
  const poll = await fetchWorker("/oauth/device/token", {
    method: "POST",
    headers: { Origin: sandbox },
    body: new URLSearchParams({ device_code }),
  });
  return { client_id, poll, device_code };
}

describe("Sideapp code login through the real OAuth provider", () => {
  it("requires browser consent and PKCE, then issues a UI-only token for the signed-in owner", async () => {
    const { client_id, poll } = await authorize("approve");
    expect(poll.status).toBe(200);
    const grant = (await poll.json()) as {
      authorization_code: string;
      redirect_uri: string;
      iss: string;
    };
    expect(grant.iss).toBe(base);
    const exchange = (codeVerifier: string) =>
      fetchWorker("/oauth/token", {
        method: "POST",
        headers: { Origin: sandbox },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id,
          redirect_uri: grant.redirect_uri,
          code: grant.authorization_code,
          code_verifier: codeVerifier,
        }),
      });
    expect((await exchange("wrong".repeat(16))).status).toBe(400);
    const redeemed = await exchange(verifier);
    expect(redeemed.status).toBe(200);
    expect(redeemed.headers.get("Access-Control-Allow-Origin")).toBe(sandbox);
    const token = (await redeemed.json()) as { access_token: string; scope: string };
    expect(token.scope).toBe("dashboard:manage");
    const headers = { Origin: sandbox, Authorization: `Bearer ${token.access_token}` };
    const me = await fetchWorker("/api/me", { headers });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: owner });
    expect((await fetchWorker("/mcp", { headers })).status).toBe(403);
    expect((await fetchWorker("/api/admin/users", { headers })).status).toBe(404);
    expect((await exchange(verifier)).status).toBe(400);
  });

  it("returns access_denied without an authorization code after browser denial", async () => {
    const { poll } = await authorize("deny");
    expect(poll.status).toBe(400);
    expect(await poll.json()).toEqual({ error: "access_denied" });
  });
});

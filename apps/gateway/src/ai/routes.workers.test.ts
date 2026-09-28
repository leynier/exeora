import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import { limiterFor } from "../rate-limit.js";
import {
  type Asked,
  aiOff,
  aiOn,
  CREDENTIALS_KEY,
  call,
  fakeProvider,
  jwt,
  seedUser,
} from "./fixtures.js";
import { storeLogin } from "./logins.js";
import { replaceOutbound } from "./outbound.js";

/** AI Assist as the dashboard reaches it: linking, unlinking, models and settings. */

const USER = "usr_ai_routes";

let restore: (() => void) | undefined;

beforeEach(async () => {
  await seedUser(USER);
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

function provider(handler: (asked: Asked) => Response | undefined | Promise<Response | undefined>) {
  const fake = fakeProvider(handler);
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const storedRow = (providerId: "openai" | "xai") =>
  db(env)
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.userId, USER), eq(schema.aiProviders.provider, providerId)))
    .get();

const loginRow = (providerId: "openai" | "xai") =>
  db(env)
    .select()
    .from(schema.aiDeviceLogins)
    .where(
      and(eq(schema.aiDeviceLogins.userId, USER), eq(schema.aiDeviceLogins.provider, providerId)),
    )
    .get();

describe("a gateway without AI Assist", () => {
  it("says the feature is off, and refuses everything else", async () => {
    const off = aiOff();
    const status = await call("/api/ai", { userId: USER, env: off });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      enabled: false,
      providers: [],
      settings: null,
      oauthAvailable: false,
    });
    const refused = [
      await call("/api/ai/providers/openai/device", { method: "POST", userId: USER, env: off }),
      await call("/api/ai/providers/openai/device/poll", {
        method: "POST",
        userId: USER,
        env: off,
      }),
      await call("/api/ai/providers/openai/key", {
        method: "PUT",
        body: { key: "sk-x" },
        userId: USER,
        env: off,
      }),
      await call("/api/ai/providers/openai", { method: "DELETE", userId: USER, env: off }),
      await call("/api/ai/providers/openai/models", { userId: USER, env: off }),
      await call("/api/ai/settings", { method: "PUT", body: {}, userId: USER, env: off }),
    ];
    for (const response of refused) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "ai_disabled" });
    }
  });

  it("is off as well with providers named and nowhere safe to keep a credential", async () => {
    const keyless = aiOn({ CLOUD_CREDENTIALS_KEY: undefined });
    const status = await call("/api/ai", { userId: USER, env: keyless });
    expect(await status.json()).toMatchObject({ enabled: false });
  });

  it("counts every AI request that spends something as a write", () => {
    expect(limiterFor(env, "POST", "/api/ai/providers/openai/device")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "POST", "/api/ai/providers/xai/device/poll")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "POST", "/api/projects/prj_1/ai/commit-message")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "POST", "/api/projects/prj_1/ai/pull-request")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "GET", "/api/ai")).toBeUndefined();
    expect(limiterFor(env, "GET", "/api/ai/providers/openai/models")).toBeUndefined();
  });
});

describe("linking ChatGPT by device code", () => {
  const ACCESS = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } });
  const ID_TOKEN = jwt({ email: "person@example.com" });

  /** OpenAI as the Codex flow sees it: pending once, then granted. */
  function codex() {
    let polls = 0;
    return provider((asked) => {
      if (asked.url.endsWith("/deviceauth/usercode")) {
        expect(asked.json()).toEqual({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" });
        return Response.json({ device_auth_id: "da_1", user_code: "ABCD-1234", interval: 5 });
      }
      if (asked.url.endsWith("/deviceauth/token")) {
        expect(asked.json()).toEqual({ device_auth_id: "da_1", user_code: "ABCD-1234" });
        polls++;
        return polls === 1
          ? Response.json({ error: "pending" }, { status: 403 })
          : Response.json({ authorization_code: "code_1", code_verifier: "verifier_1" });
      }
      if (asked.url === "https://auth.openai.com/oauth/token") {
        expect(Object.fromEntries(asked.form())).toEqual({
          grant_type: "authorization_code",
          code: "code_1",
          code_verifier: "verifier_1",
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
          redirect_uri: "http://localhost:1455/auth/callback",
        });
        return Response.json({
          access_token: ACCESS,
          refresh_token: "rt_1",
          id_token: ID_TOKEN,
          expires_in: 3600,
        });
      }
      return undefined;
    });
  }

  it("starts, polls and keeps an encrypted credential the status shows as linked", async () => {
    codex();
    const on = aiOn();
    const started = await call("/api/ai/providers/openai/device", {
      method: "POST",
      userId: USER,
      env: on,
    });
    expect(started.status).toBe(200);
    const login = (await started.json()) as Record<string, unknown>;
    expect(login).toMatchObject({
      userCode: "ABCD-1234",
      verificationUrl: "https://auth.openai.com/codex/device",
      interval: 5,
    });
    expect(login.expiresAt).toBeGreaterThan(Date.now());
    expect(await loginRow("openai")).toMatchObject({ deviceId: "da_1", userCode: "ABCD-1234" });

    const pending = await call("/api/ai/providers/openai/device/poll", {
      method: "POST",
      userId: USER,
      env: on,
    });
    expect(await pending.json()).toEqual({ status: "pending" });

    const granted = await call("/api/ai/providers/openai/device/poll", {
      method: "POST",
      userId: USER,
      env: on,
    });
    expect(await granted.json()).toEqual({
      status: "granted",
      linked: { kind: "oauth", accountLabel: "person@example.com" },
    });
    expect(await loginRow("openai")).toBeUndefined();

    const row = await storedRow("openai");
    expect(row).toMatchObject({ authKind: "oauth", accountId: "acct_1" });
    expect(row?.accessCiphertext).not.toContain(ACCESS);
    expect(row?.refreshCiphertext).not.toContain("rt_1");
    expect(await decryptSecret(CREDENTIALS_KEY, row?.accessCiphertext ?? "")).toBe(ACCESS);
    expect(await decryptSecret(CREDENTIALS_KEY, row?.refreshCiphertext ?? "")).toBe("rt_1");
    expect(row?.accessExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 3_000_000);

    const status = await call("/api/ai", { userId: USER, env: on });
    const body = (await status.json()) as { providers: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ enabled: true, oauthAvailable: true });
    expect(body.providers.map((entry) => entry.id)).toEqual(["openai", "xai"]);
    expect(body.providers[0]).toMatchObject({
      id: "openai",
      authKinds: ["oauth", "api_key"],
      linked: { kind: "oauth", accountLabel: "person@example.com" },
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.5-mini" },
        { id: "gpt-5.5-codex" },
      ],
    });
    expect(body.providers[1]).toMatchObject({ id: "xai", linked: null });
  });

  it("says when the login expired before the person entered the code", async () => {
    const fake = codex();
    await storeLogin(env, { credentialsKey: CREDENTIALS_KEY }, USER, "openai", {
      deviceId: "da_old",
      userCode: "OLD",
      verificationUrl: "https://auth.openai.com/codex/device",
      interval: 5,
      expiresAt: Date.now() - 1_000,
    });
    const response = await call("/api/ai/providers/openai/device/poll", {
      method: "POST",
      userId: USER,
      env: aiOn(),
    });
    expect(await response.json()).toEqual({ status: "expired" });
    expect(await loginRow("openai")).toBeUndefined();
    expect(fake.asked).toHaveLength(0);
  });

  it("names a poll with nothing to poll", async () => {
    const response = await call("/api/ai/providers/openai/device/poll", {
      method: "POST",
      userId: USER,
      env: aiOn(),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "ai_login_missing" });
  });

  it("offers no device login when the gateway keeps only API keys", async () => {
    const keysOnly = aiOn({ AI_ASSIST_OAUTH: "off" });
    const status = (await (await call("/api/ai", { userId: USER, env: keysOnly })).json()) as {
      oauthAvailable: boolean;
      providers: Array<{ authKinds: string[] }>;
    };
    expect(status.oauthAvailable).toBe(false);
    expect(status.providers.map((entry) => entry.authKinds)).toEqual([["api_key"], ["api_key"]]);
    const refused = await call("/api/ai/providers/openai/device", {
      method: "POST",
      userId: USER,
      env: keysOnly,
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "ai_oauth_unavailable" });
  });

  it("offers xAI by key only without a client id, and only the providers named", async () => {
    const status = (await (
      await call("/api/ai", { userId: USER, env: aiOn({ XAI_OAUTH_CLIENT_ID: undefined }) })
    ).json()) as { providers: Array<{ id: string; authKinds: string[] }> };
    expect(status.providers).toMatchObject([
      { id: "openai", authKinds: ["oauth", "api_key"] },
      { id: "xai", authKinds: ["api_key"] },
    ]);
    const one = (await (
      await call("/api/ai", { userId: USER, env: aiOn({ AI_ASSIST_PROVIDERS: " XAI " }) })
    ).json()) as { providers: Array<{ id: string }> };
    expect(one.providers.map((entry) => entry.id)).toEqual(["xai"]);
    const unknown = await call("/api/ai/providers/openai/device", {
      method: "POST",
      userId: USER,
      env: aiOn({ AI_ASSIST_PROVIDERS: "xai" }),
    });
    expect(unknown.status).toBe(404);
  });
});

describe("linking Grok by device code", () => {
  it("finds the endpoints by discovery and follows the standard grant", async () => {
    let polls = 0;
    provider((asked) => {
      if (asked.url === "https://auth.x.ai/.well-known/openid-configuration") {
        return Response.json({
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device",
          token_endpoint: "https://auth.x.ai/oauth2/token",
        });
      }
      if (asked.url === "https://auth.x.ai/oauth2/device") {
        expect(asked.form().get("client_id")).toBe("xai-client-for-tests");
        return Response.json({
          device_code: "dc_1",
          user_code: "WXYZ-9876",
          verification_uri: "https://auth.x.ai/device",
          verification_uri_complete: "https://auth.x.ai/device?code=WXYZ-9876",
          interval: 7,
          expires_in: 600,
        });
      }
      if (asked.url === "https://auth.x.ai/oauth2/token") {
        expect(Object.fromEntries(asked.form())).toEqual({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: "dc_1",
          client_id: "xai-client-for-tests",
        });
        polls++;
        return polls === 1
          ? Response.json({ error: "authorization_pending" }, { status: 400 })
          : Response.json({
              access_token: "xai_at_1",
              refresh_token: "xai_rt_1",
              expires_in: 3600,
            });
      }
      return undefined;
    });
    const on = aiOn();
    const started = await call("/api/ai/providers/xai/device", {
      method: "POST",
      userId: USER,
      env: on,
    });
    expect(await started.json()).toMatchObject({
      userCode: "WXYZ-9876",
      verificationUrl: "https://auth.x.ai/device?code=WXYZ-9876",
      interval: 7,
    });
    const poll = () =>
      call("/api/ai/providers/xai/device/poll", { method: "POST", userId: USER, env: on });
    expect(await (await poll()).json()).toEqual({ status: "pending" });
    expect(await (await poll()).json()).toEqual({
      status: "granted",
      linked: { kind: "oauth", accountLabel: null },
    });
    const row = await storedRow("xai");
    expect(await decryptSecret(CREDENTIALS_KEY, row?.accessCiphertext ?? "")).toBe("xai_at_1");
  });

  it("drops the login when the person declines", async () => {
    provider((asked) => {
      if (asked.url.endsWith("openid-configuration")) {
        return Response.json({
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device",
          token_endpoint: "https://auth.x.ai/oauth2/token",
        });
      }
      if (asked.url.endsWith("/oauth2/device")) {
        return Response.json({
          device_code: "dc_2",
          user_code: "NO",
          verification_uri: "https://auth.x.ai/device",
        });
      }
      return Response.json({ error: "access_denied" }, { status: 400 });
    });
    const on = aiOn();
    await call("/api/ai/providers/xai/device", { method: "POST", userId: USER, env: on });
    const poll = await call("/api/ai/providers/xai/device/poll", {
      method: "POST",
      userId: USER,
      env: on,
    });
    expect(await poll.json()).toEqual({ status: "denied" });
    expect(await loginRow("xai")).toBeUndefined();
    expect(await storedRow("xai")).toBeUndefined();
  });
});

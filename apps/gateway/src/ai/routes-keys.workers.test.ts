import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import { type Asked, aiOn, CREDENTIALS_KEY, call, fakeProvider, seedUser } from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";

/** AI Assist as the dashboard reaches it, continued: API keys, models and settings. */

const USER = "usr_ai_routes_keys";

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

describe("linking by API key", () => {
  it("checks the key with the provider, keeps it encrypted and lists the models with it", async () => {
    const fake = provider((asked) => {
      if (asked.url === "https://api.openai.com/v1/models") {
        if (asked.headers.get("authorization") !== "Bearer sk-test-key") {
          return Response.json({ error: "no" }, { status: 401 });
        }
        return Response.json({
          data: [
            { id: "gpt-5.5" },
            { id: "gpt-4.1" },
            { id: "gpt-4o-audio-preview" },
            { id: "o3" },
          ],
        });
      }
      return undefined;
    });
    const on = aiOn();
    const linked = await call("/api/ai/providers/openai/key", {
      method: "PUT",
      body: { key: " sk-test-key " },
      userId: USER,
      env: on,
    });
    expect(linked.status).toBe(200);
    expect(await linked.json()).toEqual({ linked: { kind: "api_key", accountLabel: null } });
    const row = await storedRow("openai");
    expect(row).toMatchObject({
      authKind: "api_key",
      accessExpiresAt: null,
      refreshCiphertext: null,
    });
    expect(row?.accessCiphertext).not.toContain("sk-test");
    expect(await decryptSecret(CREDENTIALS_KEY, row?.accessCiphertext ?? "")).toBe("sk-test-key");

    const models = await call("/api/ai/providers/openai/models", { userId: USER, env: on });
    expect(await models.json()).toEqual({
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.5-mini", label: "GPT-5.5 mini" },
        { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" },
        { id: "gpt-4.1", label: "gpt-4.1" },
      ],
    });
    expect(fake.asked).toHaveLength(2);
  });

  it("refuses a key the provider does not accept, and keeps nothing", async () => {
    provider(() => Response.json({ error: "bad key" }, { status: 401 }));
    const response = await call("/api/ai/providers/xai/key", {
      method: "PUT",
      body: { key: "xai-bad" },
      userId: USER,
      env: aiOn(),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "ai_invalid_key" });
    expect(await storedRow("xai")).toBeUndefined();
  });

  it("answers 502 when the provider cannot check the key", async () => {
    provider(() => Response.json({}, { status: 503 }));
    const response = await call("/api/ai/providers/openai/key", {
      method: "PUT",
      body: { key: "sk-x" },
      userId: USER,
      env: aiOn(),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "ai_unavailable" });
  });

  it("forgets the link on delete, and says when there was none", async () => {
    provider(() => Response.json({ data: [] }));
    const on = aiOn();
    await call("/api/ai/providers/openai/key", {
      method: "PUT",
      body: { key: "sk-x" },
      userId: USER,
      env: on,
    });
    const removed = await call("/api/ai/providers/openai", {
      method: "DELETE",
      userId: USER,
      env: on,
    });
    expect(await removed.json()).toEqual({ ok: true, removed: true });
    expect(await storedRow("openai")).toBeUndefined();
    const again = await call("/api/ai/providers/openai", {
      method: "DELETE",
      userId: USER,
      env: on,
    });
    expect(await again.json()).toEqual({ ok: true, removed: false });
    const models = await call("/api/ai/providers/openai/models", { userId: USER, env: on });
    expect(models.status).toBe(409);
    expect(await models.json()).toMatchObject({ error: "ai_not_linked" });
  });

  it("falls back to the curated models when the provider will not list", async () => {
    provider((asked) =>
      asked.method === "PUT" ||
      (asked.url.endsWith("/v1/models") && asked.headers.get("accept") !== "application/json")
        ? Response.json({ data: [] })
        : Response.json({}, { status: 500 }),
    );
    const on = aiOn();
    await call("/api/ai/providers/xai/key", {
      method: "PUT",
      body: { key: "xai-ok" },
      userId: USER,
      env: on,
    });
    const models = await call("/api/ai/providers/xai/models", { userId: USER, env: on });
    expect(await models.json()).toEqual({
      models: [
        { id: "grok-4-fast", label: "Grok 4 Fast" },
        { id: "grok-4", label: "Grok 4" },
        { id: "grok-code-fast-1", label: "Grok Code Fast 1" },
      ],
    });
  });
});

describe("settings", () => {
  it("keeps the default provider and each operation's choices, clearing with null", async () => {
    const on = aiOn();
    const written = await call("/api/ai/settings", {
      method: "PUT",
      body: {
        defaultProvider: "openai",
        operations: {
          commit: { model: "gpt-5.5-mini", instructions: "Write in Spanish." },
          pull_request: { provider: "xai" },
        },
      },
      userId: USER,
      env: on,
    });
    expect(written.status).toBe(200);
    const expected = {
      defaultProvider: "openai",
      operations: {
        commit: { provider: null, model: "gpt-5.5-mini", instructions: "Write in Spanish." },
        pull_request: { provider: "xai", model: null, instructions: null },
      },
    };
    expect(await written.json()).toEqual(expected);
    const status = (await (await call("/api/ai", { userId: USER, env: on })).json()) as {
      settings: unknown;
    };
    expect(status.settings).toEqual(expected);

    const cleared = await call("/api/ai/settings", {
      method: "PUT",
      body: { defaultProvider: null, operations: { commit: { instructions: "   " } } },
      userId: USER,
      env: on,
    });
    expect(await cleared.json()).toEqual({
      ...expected,
      defaultProvider: null,
      operations: {
        ...expected.operations,
        commit: { ...expected.operations.commit, instructions: null },
      },
    });
  });

  it("refuses instructions past 4000 characters and a provider the gateway does not offer", async () => {
    const long = await call("/api/ai/settings", {
      method: "PUT",
      body: { operations: { commit: { instructions: "x".repeat(4001) } } },
      userId: USER,
      env: aiOn(),
    });
    expect(long.status).toBe(400);
    const unoffered = await call("/api/ai/settings", {
      method: "PUT",
      body: { defaultProvider: "xai" },
      userId: USER,
      env: aiOn({ AI_ASSIST_PROVIDERS: "openai" }),
    });
    expect(unoffered.status).toBe(400);
    expect(await unoffered.json()).toMatchObject({ error: "ai_provider_unavailable" });
  });
});

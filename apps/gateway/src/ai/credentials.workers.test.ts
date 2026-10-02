import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import { current, forgetCredential, linkedProviders, storeCredential } from "./credentials.js";
import { aiOn, CREDENTIALS_KEY, fakeProvider, seedUser } from "./fixtures.js";
import { openai } from "./providers/openai.js";
import { type AiEnv, AiError, type AiProvider, type GrantedTokens } from "./providers/types.js";

/** Credential routing: legacy OpenAI rows are inert; API keys and xAI OAuth renew normally. */

const USER = "usr_ai_credentials";
const KEY = { credentialsKey: CREDENTIALS_KEY };
const HOUR = 3_600_000;

beforeEach(async () => {
  await seedUser(USER);
});

const stored = (provider: "openai" | "xai") =>
  db(env)
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.userId, USER), eq(schema.aiProviders.provider, provider)))
    .get();

async function opened(provider: "openai" | "xai") {
  const row = await stored(provider);
  if (!row) return null;
  return {
    access: await decryptSecret(CREDENTIALS_KEY, row.accessCiphertext),
    refresh: row.refreshCiphertext
      ? await decryptSecret(CREDENTIALS_KEY, row.refreshCiphertext)
      : null,
    expiresAt: row.accessExpiresAt?.getTime() ?? null,
  };
}

function xaiRefreshProvider(refresh: (token: string) => Promise<GrantedTokens>): AiProvider {
  return {
    id: "xai",
    label: "Grok / xAI",
    authKinds: ["oauth"],
    refresh: async (_fetcher: typeof fetch, _env: AiEnv, token: string) => refresh(token),
  } as unknown as AiProvider;
}

const aboutToExpireXai = (now: number) =>
  storeCredential(env, KEY, USER, "xai", "oauth", {
    access: "xai-at-1",
    refresh: "xai-rt-1",
    expiresAt: now + 60_000,
    accountId: "xai-account",
  });

describe("legacy OpenAI credentials", () => {
  it("marks the row legacy and refuses before decryption, refresh or outbound fetch", async () => {
    await storeCredential(env, KEY, USER, "openai", "oauth", {
      access: "legacy-access",
      refresh: "legacy-refresh",
      accountLabel: "legacy@example.com",
      expiresAt: Date.now() + 1,
    });
    const fake = fakeProvider(() => {
      throw new Error("legacy credential attempted an outbound request");
    });

    // A wrong key proves the branch happens before decryptSecret. The row must remain
    // available for the explicit unlink action.
    const failure = await current(
      aiOn(),
      { credentialsKey: "a-different-key" },
      USER,
      openai,
      fake.fetcher,
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ kind: "legacy" });
    expect(fake.asked).toHaveLength(0);
    expect(await opened("openai")).toMatchObject({
      access: "legacy-access",
      refresh: "legacy-refresh",
    });
    expect(await linkedProviders(env, USER)).toEqual([
      {
        provider: "openai",
        kind: "oauth",
        accountLabel: "legacy@example.com",
        legacy: true,
      },
    ]);

    expect(await forgetCredential(env, USER, "openai")).toBe(true);
    expect(await stored("openai")).toBeUndefined();
  });
});

describe("current", () => {
  it("hands out an API key without asking the provider", async () => {
    const fake = fakeProvider(() => undefined);
    await storeCredential(env, KEY, USER, "openai", "api_key", { access: "sk-key" });
    expect(await current(aiOn(), KEY, USER, openai, fake.fetcher)).toEqual({
      kind: "api_key",
      access: "sk-key",
      accountId: undefined,
    });
    expect(fake.asked).toHaveLength(0);
  });

  it("says when nothing is linked", async () => {
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, openai, fake.fetcher)).rejects.toMatchObject({
      kind: "not_linked",
    });
  });

  it("renews xAI once for two concurrent requests and keeps the new pair", async () => {
    const now = Date.now();
    await aboutToExpireXai(now);
    let refreshes = 0;
    const provider = xaiRefreshProvider(async (token) => {
      refreshes++;
      expect(token).toBe("xai-rt-1");
      return {
        access: "xai-at-2",
        refresh: "xai-rt-2",
        expiresAt: now + HOUR,
        accountId: "xai-account",
      };
    });
    const fake = fakeProvider(() => undefined);
    const [a, b] = await Promise.all([
      current(aiOn(), KEY, USER, provider, fake.fetcher, now),
      current(aiOn(), KEY, USER, provider, fake.fetcher, now),
    ]);
    expect(a).toEqual({ kind: "oauth", access: "xai-at-2", accountId: "xai-account" });
    expect(b).toEqual(a);
    expect(refreshes).toBe(1);
    expect(await opened("xai")).toMatchObject({ access: "xai-at-2", refresh: "xai-rt-2" });
  });

  it("keeps what another gateway stored when its own write finds the row changed", async () => {
    const now = Date.now();
    await aboutToExpireXai(now);
    const provider = xaiRefreshProvider(async () => {
      await storeCredential(env, KEY, USER, "xai", "oauth", {
        access: "xai-at-other",
        refresh: "xai-rt-other",
        expiresAt: now + HOUR,
        accountId: "xai-account",
      });
      return {
        access: "xai-at-2",
        refresh: "xai-rt-2",
        expiresAt: now + HOUR,
        accountId: "xai-account",
      };
    });
    const fake = fakeProvider(() => undefined);
    expect(await current(aiOn(), KEY, USER, provider, fake.fetcher, now)).toEqual({
      kind: "oauth",
      access: "xai-at-other",
      accountId: "xai-account",
    });
    expect(await opened("xai")).toMatchObject({ access: "xai-at-other", refresh: "xai-rt-other" });
  });

  it("keeps what another gateway stored when its own refresh token was already spent", async () => {
    const now = Date.now();
    await aboutToExpireXai(now);
    const provider = xaiRefreshProvider(async () => {
      await storeCredential(env, KEY, USER, "xai", "oauth", {
        access: "xai-at-other",
        refresh: "xai-rt-other",
        expiresAt: now + HOUR,
      });
      throw new AiError("reconnect", "xAI rejected the refresh.");
    });
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, provider, fake.fetcher, now)).resolves.toMatchObject({
      access: "xai-at-other",
    });
    expect(await opened("xai")).toMatchObject({ access: "xai-at-other", refresh: "xai-rt-other" });
  });

  it("removes an xAI credential after an invalid refresh grant", async () => {
    const now = Date.now();
    await storeCredential(env, KEY, USER, "xai", "oauth", {
      access: "xai-at-1",
      refresh: "xai-rt-1",
      expiresAt: now + 1,
    });
    const provider = xaiRefreshProvider(async () => {
      throw new AiError("reconnect", "xAI rejected the refresh.");
    });
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, provider, fake.fetcher, now)).rejects.toMatchObject({
      kind: "reconnect",
    });
    expect(await stored("xai")).toBeUndefined();
  });

  it("forgets an xAI credential that is about to expire without a refresh token", async () => {
    const now = Date.now();
    await storeCredential(env, KEY, USER, "xai", "oauth", {
      access: "xai-at-1",
      expiresAt: now + 1,
    });
    const provider = xaiRefreshProvider(async () => {
      throw new Error("refresh must not be called without a token");
    });
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, provider, fake.fetcher, now)).rejects.toMatchObject({
      kind: "reconnect",
    });
    expect(await stored("xai")).toBeUndefined();
    expect(fake.asked).toHaveLength(0);
  });

  it("leaves an xAI credential alone when the provider is temporarily unavailable", async () => {
    const now = Date.now();
    await aboutToExpireXai(now);
    const provider = xaiRefreshProvider(async () => {
      throw new AiError("unavailable", "xAI is unavailable.");
    });
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, provider, fake.fetcher, now)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await opened("xai")).toMatchObject({ access: "xai-at-1", refresh: "xai-rt-1" });
  });
});

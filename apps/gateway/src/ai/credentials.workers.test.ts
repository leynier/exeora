import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import { current, linkedProviders, storeCredential } from "./credentials.js";
import { type Asked, aiOn, CREDENTIALS_KEY, fakeProvider, jwt, seedUser } from "./fixtures.js";
import { grantOf, openai } from "./providers/openai.js";
import { AiError } from "./providers/types.js";

/** The OAuth credential over its life: handed out, renewed, and given up on. */

const USER = "usr_ai_credentials";
const KEY = { credentialsKey: CREDENTIALS_KEY };
const HOUR = 3_600_000;

beforeEach(async () => {
  await seedUser(USER);
});

const stored = () =>
  db(env)
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.userId, USER), eq(schema.aiProviders.provider, "openai")))
    .get();

async function opened() {
  const row = await stored();
  if (!row) return null;
  return {
    access: await decryptSecret(CREDENTIALS_KEY, row.accessCiphertext),
    refresh: row.refreshCiphertext
      ? await decryptSecret(CREDENTIALS_KEY, row.refreshCiphertext)
      : null,
    expiresAt: row.accessExpiresAt?.getTime() ?? null,
  };
}

/** A token five minutes short of its renewal margin. */
async function aboutToExpire(now: number) {
  await storeCredential(env, KEY, USER, "openai", "oauth", {
    access: "at_1",
    refresh: "rt_1",
    expiresAt: now + 60_000,
    accountId: "acct_1",
  });
}

const isRefresh = (asked: Asked) =>
  asked.url === "https://auth.openai.com/oauth/token" &&
  asked.form().get("grant_type") === "refresh_token";

const renewed = () =>
  Response.json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 });

describe("current", () => {
  it.each(["new", "legacy"])(
    "renews a %s Codex JWT without expires_in and persists the renewed JWT expiry",
    async (kind) => {
      const now = Date.now();
      const access = jwt({ exp: Math.floor((now + 60_000) / 1000) });
      const refreshed = jwt({ exp: Math.floor((now + HOUR) / 1000) });
      await storeCredential(
        env,
        KEY,
        USER,
        "openai",
        "oauth",
        kind === "new"
          ? grantOf({ access_token: access, refresh_token: "rt_jwt" })
          : { access, refresh: "rt_jwt" },
      );
      const fake = fakeProvider((asked) => {
        expect(isRefresh(asked)).toBe(true);
        expect(asked.form().get("refresh_token")).toBe("rt_jwt");
        return Response.json({ access_token: refreshed, refresh_token: "rt_rotated" });
      });
      expect(await current(aiOn(), KEY, USER, openai, fake.fetcher, now)).toMatchObject({
        access: refreshed,
      });
      expect(fake.asked).toHaveLength(1);
      expect(await opened()).toMatchObject({
        refresh: "rt_rotated",
        expiresAt: Math.floor((now + HOUR) / 1000) * 1000,
      });
    },
  );
  it("hands out an unexpired token and an API key without asking the provider", async () => {
    const now = Date.now();
    const fake = fakeProvider(() => undefined);
    await storeCredential(env, KEY, USER, "openai", "oauth", {
      access: "at_fresh",
      refresh: "rt_fresh",
      expiresAt: now + HOUR,
      accountId: "acct_1",
    });
    expect(await current(aiOn(), KEY, USER, openai, fake.fetcher, now)).toEqual({
      kind: "oauth",
      access: "at_fresh",
      accountId: "acct_1",
    });
    await storeCredential(env, KEY, USER, "openai", "api_key", { access: "sk-key" });
    expect(await current(aiOn(), KEY, USER, openai, fake.fetcher, now)).toEqual({
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

  it("renews once for two concurrent requests and keeps the new pair", async () => {
    const now = Date.now();
    await aboutToExpire(now);
    let refreshes = 0;
    const fake = fakeProvider((asked) => {
      if (!isRefresh(asked)) return undefined;
      refreshes++;
      expect(asked.form().get("refresh_token")).toBe("rt_1");
      return renewed();
    });
    const on = aiOn();
    const [a, b] = await Promise.all([
      current(on, KEY, USER, openai, fake.fetcher, now),
      current(on, KEY, USER, openai, fake.fetcher, now),
    ]);
    expect(a).toEqual({ kind: "oauth", access: "at_2", accountId: "acct_1" });
    expect(b).toEqual(a);
    expect(refreshes).toBe(1);
    const kept = await opened();
    expect(kept).toMatchObject({ access: "at_2", refresh: "rt_2" });
    // Stamped by the provider's own clock, a moment after `now`.
    expect(kept?.expiresAt).toBeGreaterThanOrEqual(now + HOUR);
    expect(kept?.expiresAt).toBeLessThan(now + HOUR + 10_000);
  });

  it("keeps what another gateway stored when its own write finds the row changed", async () => {
    const now = Date.now();
    await aboutToExpire(now);
    const fake = fakeProvider(async (asked) => {
      if (!isRefresh(asked)) return undefined;
      // Another isolate renewed first and wrote its pair while this one waited.
      await storeCredential(env, KEY, USER, "openai", "oauth", {
        access: "at_other",
        refresh: "rt_other",
        expiresAt: now + HOUR,
        accountId: "acct_1",
      });
      return renewed();
    });
    expect(await current(aiOn(), KEY, USER, openai, fake.fetcher, now)).toEqual({
      kind: "oauth",
      access: "at_other",
      accountId: "acct_1",
    });
    expect(await opened()).toMatchObject({ access: "at_other", refresh: "rt_other" });
  });

  it("keeps what another gateway stored when its own refresh token was already spent", async () => {
    const now = Date.now();
    await aboutToExpire(now);
    const fake = fakeProvider(async (asked) => {
      if (!isRefresh(asked)) return undefined;
      await storeCredential(env, KEY, USER, "openai", "oauth", {
        access: "at_other",
        refresh: "rt_other",
        expiresAt: now + HOUR,
      });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });
    expect(await current(aiOn(), KEY, USER, openai, fake.fetcher, now)).toMatchObject({
      access: "at_other",
    });
  });

  it("forgets a credential the provider refuses to renew", async () => {
    const now = Date.now();
    await aboutToExpire(now);
    const fake = fakeProvider((asked) =>
      isRefresh(asked) ? Response.json({ error: "invalid_grant" }, { status: 400 }) : undefined,
    );
    const failure = await current(aiOn(), KEY, USER, openai, fake.fetcher, now).catch((e) => e);
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ kind: "reconnect" });
    expect(await stored()).toBeUndefined();
    expect(await linkedProviders(env, USER)).toEqual([]);
  });

  it("forgets a token about to expire that has nothing to renew it with", async () => {
    const now = Date.now();
    await storeCredential(env, KEY, USER, "openai", "oauth", {
      access: "at_1",
      expiresAt: now + 1,
    });
    const fake = fakeProvider(() => undefined);
    await expect(current(aiOn(), KEY, USER, openai, fake.fetcher, now)).rejects.toMatchObject({
      kind: "reconnect",
    });
    expect(await stored()).toBeUndefined();
    expect(fake.asked).toHaveLength(0);
  });

  it("leaves the credential alone when the provider merely cannot be reached", async () => {
    const now = Date.now();
    await aboutToExpire(now);
    const fake = fakeProvider(() => Response.json({}, { status: 503 }));
    await expect(current(aiOn(), KEY, USER, openai, fake.fetcher, now)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await opened()).toMatchObject({ access: "at_1", refresh: "rt_1" });
  });
});

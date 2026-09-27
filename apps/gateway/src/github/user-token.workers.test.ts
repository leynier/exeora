import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import { GitHubError, GitHubReconnectError } from "./app.js";
import {
  type Asked,
  authorize,
  CLOUD_CREDENTIALS_KEY,
  envOff,
  envOn,
  fakeGitHub,
} from "./fixtures.js";
import { hasUserToken, userAccessToken, userFetch } from "./user-token.js";

/**
 * The person's own token: kept encrypted, renewed before it runs out, and
 * forgotten when GitHub will have no more of it.
 */

const USER = "usr_github_token";
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const HOUR = 60 * 60;

beforeEach(async () => {
  await db(env).delete(schema.users).where(eq(schema.users.id, USER)).run();
  await db(env).insert(schema.users).values({ id: USER, email: "github-token@example.com" }).run();
});

const stored = () =>
  db(env)
    .select()
    .from(schema.githubUserTokens)
    .where(eq(schema.githubUserTokens.userId, USER))
    .get();

const opened = (ciphertext: string | null | undefined) =>
  ciphertext ? decryptSecret(CLOUD_CREDENTIALS_KEY, ciphertext) : Promise.resolve(null);

/** GitHub's token endpoint, granting a new pair for the refresh token it expects. */
function renewing(expected: string, granted: Record<string, unknown>) {
  return fakeGitHub((asked: Asked) => {
    if (asked.url !== "https://github.com/login/oauth/access_token") return undefined;
    const body = asked.body as { refresh_token?: string };
    return Response.json(
      body.refresh_token === expected ? granted : { error: "bad_refresh_token" },
    );
  });
}

describe("the token of the person who connected", () => {
  it("is kept encrypted, with when it runs out", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: NOW,
    });
    const row = await stored();
    expect(row?.accessCiphertext?.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain("ghu_first");
    expect(JSON.stringify(row)).not.toContain("ghr_first");
    expect(await opened(row?.accessCiphertext)).toBe("ghu_first");
    expect(await opened(row?.refreshCiphertext)).toBe("ghr_first");
    expect(row?.accessExpiresAt?.getTime()).toBe(NOW + 8 * HOUR * 1000);
    expect(await hasUserToken(env, USER)).toBe(true);
  });

  it("is used as it is while it has more than five minutes left, and asks GitHub nothing", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: NOW,
    });
    const { fetcher, asked } = renewing("ghr_first", {});
    const late = NOW + (8 * HOUR - 6 * 60) * 1000;
    expect(await userAccessToken(await envOn(), USER, fetcher, late)).toBe("ghu_first");
    expect(asked).toEqual([]);

    // One that does not expire is never renewed.
    await authorize(USER, { accessToken: "ghu_forever", now: NOW });
    expect((await stored())?.accessExpiresAt).toBeNull();
    expect(await userAccessToken(await envOn(), USER, fetcher, NOW + 365 * 24 * HOUR * 1000)).toBe(
      "ghu_forever",
    );
    expect(asked).toEqual([]);
  });

  it("is renewed in its last five minutes, and the new pair is what is kept", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: NOW,
    });
    const { fetcher, asked } = renewing("ghr_first", {
      access_token: "ghu_second",
      expires_in: 8 * HOUR,
      refresh_token: "ghr_second",
      refresh_token_expires_in: 15_897_600,
    });
    const late = NOW + (8 * HOUR - 4 * 60) * 1000;

    expect(await userAccessToken(await envOn(), USER, fetcher, late)).toBe("ghu_second");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.body).toEqual({
      client_id: "Iv1.not-a-real-client",
      client_secret: "client-secret-that-is-not-real",
      grant_type: "refresh_token",
      refresh_token: "ghr_first",
    });
    expect(asked[0]?.headers.get("Accept")).toBe("application/json");

    const row = await stored();
    expect(await opened(row?.accessCiphertext)).toBe("ghu_second");
    expect(await opened(row?.refreshCiphertext)).toBe("ghr_second");
    expect(row?.accessExpiresAt?.getTime()).toBe(late + 8 * HOUR * 1000);
    expect(row?.login).toBe("octocat");

    // The next request finds the new one, and has no reason to ask again.
    expect(await userAccessToken(await envOn(), USER, fetcher, late + 60_000)).toBe("ghu_second");
    expect(asked).toHaveLength(1);
  });

  it("is forgotten when GitHub refuses to renew it, and the account has to connect again", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_revoked",
      now: NOW,
    });
    const { fetcher } = renewing("ghr_something_else", { access_token: "never" });
    const late = NOW + 8 * HOUR * 1000;

    const error = await userAccessToken(await envOn(), USER, fetcher, late).catch(
      (thrown) => thrown,
    );
    expect(error).toBeInstanceOf(GitHubReconnectError);
    expect((error as GitHubReconnectError).message).toContain("Connect GitHub again");
    expect(await stored()).toMatchObject({
      accessCiphertext: null,
      accessExpiresAt: null,
      refreshCiphertext: null,
      login: "octocat",
    });
    expect(await hasUserToken(env, USER)).toBe(false);
    // And it stays that way without GitHub being asked again.
    const quiet = fakeGitHub(() => undefined);
    await expect(userAccessToken(await envOn(), USER, quiet.fetcher, late)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );
    expect(quiet.asked).toEqual([]);
  });

  it("has nothing to renew an expired token with when no refresh token was given", async () => {
    await authorize(USER, { accessToken: "ghu_first", expiresIn: HOUR, now: NOW });
    const { fetcher, asked } = renewing("any", {});
    await expect(
      userAccessToken(await envOn(), USER, fetcher, NOW + HOUR * 1000),
    ).rejects.toBeInstanceOf(GitHubReconnectError);
    expect(asked).toEqual([]);
    expect(await hasUserToken(env, USER)).toBe(false);
  });

  it("keeps what it has when GitHub could not be asked", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: NOW,
    });
    const late = NOW + 8 * HOUR * 1000;
    const down = fakeGitHub(() => Response.json({}, { status: 503 }));
    const error = await userAccessToken(await envOn(), USER, down.fetcher, late).catch(
      (thrown) => thrown,
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).not.toBeInstanceOf(GitHubReconnectError);

    // Nor is the person made to connect again over the gateway's own secret.
    const misconfigured = fakeGitHub(() =>
      Response.json({ error: "incorrect_client_credentials" }),
    );
    const wrong = await userAccessToken(await envOn(), USER, misconfigured.fetcher, late).catch(
      (thrown) => thrown,
    );
    expect(wrong).toMatchObject({ status: 401 });
    expect(wrong).not.toBeInstanceOf(GitHubReconnectError);
    expect(await opened((await stored())?.refreshCiphertext)).toBe("ghr_first");
  });

  it("takes the pair another request renewed first, rather than disconnecting", async () => {
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: NOW,
    });
    const late = NOW + 8 * HOUR * 1000;
    // The refresh token is good once. By the time this request presents it,
    // another has spent it and stored what it was given.
    const { fetcher } = fakeGitHub(async (asked: Asked) => {
      if (asked.url !== "https://github.com/login/oauth/access_token") return undefined;
      await authorize(USER, {
        accessToken: "ghu_by_the_other",
        expiresIn: 8 * HOUR,
        refreshToken: "ghr_by_the_other",
        now: late,
      });
      return Response.json({ error: "bad_refresh_token" });
    });

    expect(await userAccessToken(await envOn(), USER, fetcher, late)).toBe("ghu_by_the_other");
    expect(await opened((await stored())?.refreshCiphertext)).toBe("ghr_by_the_other");
  });

  it("is forgotten when GitHub answers it with 401", async () => {
    await authorize(USER, { accessToken: "ghu_revoked_on_github" });
    const { fetcher } = fakeGitHub(() =>
      Response.json({ message: "Bad credentials" }, { status: 401 }),
    );
    await expect(
      userFetch(await envOn(), USER, "https://api.github.com/user", fetcher),
    ).rejects.toBeInstanceOf(GitHubReconnectError);
    expect(await hasUserToken(env, USER)).toBe(false);
  });

  it("is not to be had for an account that never connected, under a key that changed, or with the connection off", async () => {
    const { fetcher } = fakeGitHub(() => undefined);
    await expect(userAccessToken(await envOn(), USER, fetcher)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );

    await authorize(USER, { accessToken: "ghu_first" });
    await expect(userAccessToken(envOff(), USER, fetcher)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );
    expect(await hasUserToken(env, USER)).toBe(true);

    const rotated = await envOn({
      CLOUD_CREDENTIALS_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    });
    await expect(userAccessToken(rotated, USER, fetcher)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );
    expect(await hasUserToken(env, USER)).toBe(false);
  });
});

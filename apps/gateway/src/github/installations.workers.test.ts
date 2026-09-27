import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import {
  APP_ID,
  APP_SLUG,
  type Asked,
  CLOUD_CREDENTIALS_KEY,
  envOff,
  envOn,
  fakeGitHub,
} from "./fixtures.js";
import { completeConnection, connectUrl, disconnect, listInstallations } from "./installations.js";

/**
 * Connecting an account, and above all the one check that makes it safe: an
 * installation is given to an account only when GitHub lists it for the
 * person who authorized.
 */

const USER = "usr_github_connect";
const OTHER = "usr_github_connect_other";

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-connect@example.com" },
      { id: OTHER, email: "github-connect-other@example.com" },
    ])
    .run();
});

function installation(id: number, login: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    app_id: Number(APP_ID),
    app_slug: APP_SLUG,
    account: { login, type: "User" },
    repository_selection: "selected",
    suspended_at: null,
    ...extra,
  };
}

/** A GitHub where the person behind `code` sees exactly `installations`. */
function github(
  installations: unknown[],
  options: { refreshToken?: string; rejectCode?: boolean } = {},
) {
  return fakeGitHub((asked: Asked) => {
    if (asked.url === "https://github.com/login/oauth/access_token") {
      if (options.rejectCode) {
        return Response.json({ error: "bad_verification_code" });
      }
      return Response.json({
        access_token: "ghu_user_token",
        token_type: "bearer",
        ...(options.refreshToken
          ? { expires_in: 28_800, refresh_token: options.refreshToken }
          : {}),
      });
    }
    if (asked.headers.get("Authorization") !== "Bearer ghu_user_token") {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    const url = new URL(asked.url);
    if (url.pathname === "/user") return Response.json({ login: "octocat" });
    if (url.pathname === "/user/installations") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const batch = installations.slice((page - 1) * 100, page * 100);
      return Response.json({ total_count: installations.length, installations: batch });
    }
    return undefined;
  });
}

const stored = (userId: string) =>
  db(env)
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.userId, userId))
    .orderBy(schema.githubInstallations.installationId)
    .all();

const token = (userId: string) =>
  db(env)
    .select()
    .from(schema.githubUserTokens)
    .where(eq(schema.githubUserTokens.userId, userId))
    .get();

describe("connecting GitHub", () => {
  it("stores nothing for an installation the person cannot see", async () => {
    // The address said 666. GitHub, asked as the person, lists only 101.
    const { fetcher } = github([installation(101, "octocat")], { refreshToken: "ghr_refresh" });
    const result = await completeConnection(
      await envOn(),
      USER,
      { code: "the-code", installationId: 666 },
      fetcher,
    );

    expect(result).toMatchObject({ ok: false, reason: "installation_not_visible" });
    expect(await stored(USER)).toEqual([]);
    expect(await token(USER)).toBeUndefined();
  });

  it("stores every installation of this app the person can see", async () => {
    const { fetcher, asked } = github(
      [
        installation(101, "octocat"),
        installation(202, "acme", {
          account: { login: "acme", type: "Organization" },
          repository_selection: "all",
          suspended_at: "2026-09-01T10:00:00Z",
        }),
        // Another app's installation, which a token of this app should never
        // list, and which is left alone if it ever does.
        installation(303, "elsewhere", { app_id: 1 }),
      ],
      { refreshToken: "ghr_refresh" },
    );
    const result = await completeConnection(
      await envOn(),
      USER,
      { code: "the-code", installationId: 101 },
      fetcher,
    );

    expect(result).toEqual({ ok: true, installations: 2, login: "octocat" });
    expect(asked[0]?.body).toMatchObject({
      client_id: "Iv1.not-a-real-client",
      client_secret: "client-secret-that-is-not-real",
      code: "the-code",
    });
    expect(asked[0]?.headers.get("Accept")).toBe("application/json");

    const rows = await stored(USER);
    expect(rows).toMatchObject([
      {
        installationId: 101,
        accountLogin: "octocat",
        accountType: "User",
        repositorySelection: "selected",
        suspendedAt: null,
      },
      {
        installationId: 202,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "all",
      },
    ]);
    expect(rows[0]?.id.startsWith("ghi_")).toBe(true);
    expect(rows[1]?.suspendedAt?.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    // The person's token is what later says what they may reach, so it is
    // kept, and kept encrypted, with the means to renew it.
    const kept = await token(USER);
    expect(kept?.login).toBe("octocat");
    expect(JSON.stringify(kept)).not.toContain("ghu_user_token");
    expect(JSON.stringify(kept)).not.toContain("ghr_refresh");
    expect(await decryptSecret(CLOUD_CREDENTIALS_KEY, kept?.accessCiphertext ?? "")).toBe(
      "ghu_user_token",
    );
    expect(await decryptSecret(CLOUD_CREDENTIALS_KEY, kept?.refreshCiphertext ?? "")).toBe(
      "ghr_refresh",
    );
    const lives = (kept?.accessExpiresAt?.getTime() ?? 0) - Date.now();
    expect(lives).toBeGreaterThan(7.9 * 60 * 60_000);
    expect(lives).toBeLessThanOrEqual(8 * 60 * 60_000);

    expect(await listInstallations(env, USER)).toMatchObject([
      {
        accountLogin: "acme",
        suspended: true,
        manageUrl: "https://github.com/organizations/acme/settings/installations/202",
      },
      {
        accountLogin: "octocat",
        suspended: false,
        manageUrl: "https://github.com/settings/installations/101",
      },
    ]);
    expect(await stored(OTHER)).toEqual([]);
  });

  it("brings the rows up to date when the account connects again", async () => {
    const first = github([installation(101, "octocat")]);
    await completeConnection(
      await envOn(),
      USER,
      { code: "one", installationId: 101 },
      first.fetcher,
    );
    const [before] = await stored(USER);

    const second = github([installation(101, "octocat-renamed", { repository_selection: "all" })]);
    await completeConnection(
      await envOn(),
      USER,
      { code: "two", installationId: 101 },
      second.fetcher,
    );
    const rows = await stored(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before?.id,
      accountLogin: "octocat-renamed",
      repositorySelection: "all",
    });
  });

  it("reads every page of the installations before it looks for the one named", async () => {
    const many = Array.from({ length: 130 }, (_, index) => installation(1000 + index, `o${index}`));
    const { fetcher, asked } = github(many);
    const result = await completeConnection(
      await envOn(),
      USER,
      { code: "the-code", installationId: 1129 },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, installations: 130 });
    expect(asked.filter((request) => request.url.includes("/user/installations"))).toHaveLength(2);
    expect(await stored(USER)).toHaveLength(130);
  });

  it("stores nothing when GitHub does not accept the code", async () => {
    const { fetcher } = github([installation(101, "octocat")], { rejectCode: true });
    const result = await completeConnection(
      await envOn(),
      USER,
      { code: "spent", installationId: 101 },
      fetcher,
    );
    expect(result).toMatchObject({ ok: false, reason: "code_rejected" });
    expect(await stored(USER)).toEqual([]);
  });

  it("keeps a token that does not expire without a date or a refresh token", async () => {
    const { fetcher } = github([installation(101, "octocat")]);
    const result = await completeConnection(
      await envOn(),
      USER,
      { code: "the-code", installationId: 101 },
      fetcher,
    );
    expect(result).toMatchObject({ ok: true });
    const kept = await token(USER);
    expect(kept).toMatchObject({ accessExpiresAt: null, refreshCiphertext: null });
    expect(await decryptSecret(CLOUD_CREDENTIALS_KEY, kept?.accessCiphertext ?? "")).toBe(
      "ghu_user_token",
    );
  });

  it("lets go of what the person who connects now is not shown", async () => {
    // The account connected before as somebody who could see two. Whoever
    // connects now sees one, and is not left holding the other.
    const first = github([installation(101, "octocat"), installation(202, "acme")]);
    await completeConnection(
      await envOn(),
      USER,
      { code: "one", installationId: 101 },
      first.fetcher,
    );
    await db(env)
      .insert(schema.devices)
      .values({ id: "dev_gh_prune", userId: USER, name: "laptop", platform: "linux" })
      .run();
    await db(env)
      .insert(schema.projects)
      .values({
        id: "prj_gh_prune",
        userId: USER,
        deviceId: "dev_gh_prune",
        name: "api",
        slug: "api",
        localPath: "/w/api",
      })
      .run();
    await db(env)
      .insert(schema.githubRepositories)
      .values({
        projectId: "prj_gh_prune",
        userId: USER,
        installationId: 202,
        repoId: 7,
        fullName: "acme/api",
      })
      .run();

    const second = github([installation(101, "octocat")]);
    await completeConnection(
      await envOn(),
      USER,
      { code: "two", installationId: 101 },
      second.fetcher,
    );
    expect((await stored(USER)).map((row) => row.installationId)).toEqual([101]);
    const link = await db(env)
      .select()
      .from(schema.githubRepositories)
      .where(eq(schema.githubRepositories.projectId, "prj_gh_prune"))
      .get();
    expect(link?.lostAccessAt).toBeInstanceOf(Date);
  });

  it("is off on a gateway with nowhere safe to keep the token", async () => {
    const { fetcher, asked } = github([installation(101, "octocat")], {
      refreshToken: "ghr_refresh",
    });
    const result = await completeConnection(
      await envOn({ CLOUD_CREDENTIALS_KEY: undefined }),
      USER,
      { code: "the-code", installationId: 101 },
      fetcher,
    );
    expect(result).toMatchObject({ ok: false, reason: "github_disabled" });
    expect(asked).toEqual([]);
    expect(await token(USER)).toBeUndefined();
  });

  it("does nothing on a gateway where the connection is off", async () => {
    const { fetcher, asked } = github([installation(101, "octocat")]);
    const result = await completeConnection(
      envOff(),
      USER,
      { code: "the-code", installationId: 101 },
      fetcher,
    );
    expect(result).toMatchObject({ ok: false, reason: "github_disabled" });
    expect(asked).toEqual([]);
  });

  it("sends the person to the app's installation page with the state", () => {
    expect(connectUrl({ GITHUB_APP_SLUG: APP_SLUG }, "a.b")).toBe(
      "https://github.com/apps/exeora-test/installations/new?state=a.b",
    );
  });
});

describe("disconnecting", () => {
  it("removes the account's installation and marks its repositories, and nobody else's", async () => {
    const database = db(env);
    await database
      .insert(schema.githubInstallations)
      .values([
        {
          id: "ghi_mine",
          userId: USER,
          installationId: 202,
          accountLogin: "acme",
          accountType: "Organization",
        },
        {
          id: "ghi_theirs",
          userId: OTHER,
          installationId: 202,
          accountLogin: "acme",
          accountType: "Organization",
        },
      ])
      .run();
    await database
      .insert(schema.devices)
      .values([
        { id: "dev_gh_mine", userId: USER, name: "laptop", platform: "linux" },
        { id: "dev_gh_theirs", userId: OTHER, name: "laptop", platform: "linux" },
      ])
      .run();
    await database
      .insert(schema.projects)
      .values([
        {
          id: "prj_gh_mine",
          userId: USER,
          deviceId: "dev_gh_mine",
          name: "api",
          slug: "api",
          localPath: "/w/api",
        },
        {
          id: "prj_gh_theirs",
          userId: OTHER,
          deviceId: "dev_gh_theirs",
          name: "api",
          slug: "api",
          localPath: "/w/api",
        },
      ])
      .run();
    await database
      .insert(schema.githubRepositories)
      .values([
        {
          projectId: "prj_gh_mine",
          userId: USER,
          installationId: 202,
          repoId: 7,
          fullName: "acme/api",
        },
        {
          projectId: "prj_gh_theirs",
          userId: OTHER,
          installationId: 202,
          repoId: 7,
          fullName: "acme/api",
        },
      ])
      .run();

    // Somebody else's row id is not found, and changes nothing.
    expect(await disconnect(env, USER, "ghi_theirs")).toBeNull();
    expect(await disconnect(env, USER, "ghi_mine")).toEqual({
      manageUrl: "https://github.com/organizations/acme/settings/installations/202",
    });

    expect(await stored(USER)).toEqual([]);
    expect(await stored(OTHER)).toHaveLength(1);
    const links = await database.select().from(schema.githubRepositories).all();
    const mine = links.find((link) => link.projectId === "prj_gh_mine");
    const theirs = links.find((link) => link.projectId === "prj_gh_theirs");
    expect(mine?.lostAccessAt).toBeInstanceOf(Date);
    expect(theirs?.lostAccessAt).toBeNull();
  });
});

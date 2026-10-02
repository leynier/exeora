import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { GitHubReconnectError } from "./app.js";
import {
  authorize,
  envOff,
  envOn,
  githubWorld,
  isTokenRequest,
  repository,
  tokenOf,
  type World,
} from "./fixtures.js";
import {
  listRepositories,
  pickedRepository,
  projectSlug,
  repositoriesCacheKey,
} from "./repositories.js";
import { hasUserToken } from "./user-token.js";

/**
 * The picker's list: what the person can reach, which is less than what the
 * installation holds, how it is cut down, and which entries are already
 * projects.
 */

const USER = "usr_github_repos";
const COLLEAGUE = "usr_github_repos_colleague";
const MINE = 5101;
const ORG = 5102;
const SUSPENDED = 5103;

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, COLLEAGUE]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    for (const installation of [MINE, ORG, SUSPENDED]) {
      await env.OAUTH_KV.delete(repositoriesCacheKey(id, installation));
    }
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-repos@example.com" },
      { id: COLLEAGUE, email: "github-repos-colleague@example.com" },
    ])
    .run();
  const held = (id: string, userId: string, installationId: number, login: string) => ({
    id,
    userId,
    installationId,
    accountLogin: login,
    accountType: login === "octocat" ? ("User" as const) : ("Organization" as const),
  });
  await database
    .insert(schema.githubInstallations)
    .values([
      held("ghi_repos_mine", USER, MINE, "octocat"),
      held("ghi_repos_org", USER, ORG, "acme"),
      { ...held("ghi_repos_suspended", USER, SUSPENDED, "frozen"), suspendedAt: new Date() },
      // The same organisation, held by a colleague who connected too.
      held("ghi_repos_colleague", COLLEAGUE, ORG, "acme"),
    ])
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: "dev_repos", userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_repos_colleague", userId: COLLEAGUE, name: "laptop", platform: "linux" },
    ])
    .run();
  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_repos_api",
        userId: USER,
        deviceId: "dev_repos",
        name: "api",
        slug: "api",
        localPath: "/w/api",
        // Written the way a laptop's remote is: the key is what matches.
        repoUrl: "git@github.com:Acme/API.git",
        repoKey: "github.com/acme/api",
      },
      {
        id: "prj_repos_foreign",
        userId: COLLEAGUE,
        deviceId: "dev_repos_colleague",
        name: "web",
        slug: "web",
        localPath: "/w/web",
        repoUrl: "https://github.com/acme/web.git",
        repoKey: "github.com/acme/web",
      },
    ])
    .run();
  await authorize(USER);
  await authorize(COLLEAGUE);
});

/**
 * The organisation gave the app four repositories. The person can open two
 * of them, and their colleague a different two.
 */
const world = (): World => ({
  installations: {
    [MINE]: [
      repository(1, "octocat/dotfiles", { pushed_at: "2026-09-10T00:00:00Z", private: true }),
      repository(2, "octocat/Api-Client", {
        pushed_at: "2026-09-20T00:00:00Z",
        description: "A client",
        default_branch: "trunk",
      }),
    ],
    [ORG]: [
      repository(3, "acme/api", { pushed_at: "2026-09-15T00:00:00Z" }),
      repository(4, "acme/web", { pushed_at: null }),
      repository(5, "acme/payroll", { private: true, pushed_at: "2026-09-25T00:00:00Z" }),
      repository(6, "acme/secrets", { private: true, pushed_at: "2026-09-26T00:00:00Z" }),
    ],
    [SUSPENDED]: [repository(7, "frozen/api")],
  },
  people: {
    [tokenOf(USER)]: {
      1: { push: true },
      2: { push: true },
      3: { push: true },
      4: { push: false },
      7: { push: true },
    },
    [tokenOf(COLLEAGUE)]: { 5: { push: true }, 6: { push: false } },
  },
});

describe("the repositories an account can pick", () => {
  it("lists what the person can open, newest push first, and nothing else the installation holds", async () => {
    const { fetcher, asked } = githubWorld(world());
    const listed = await listRepositories(await envOn(), USER, {}, fetcher);

    // `acme/payroll` and `acme/secrets` are in the installation the account
    // holds, were pushed to last, and are not the person's to see.
    expect(listed.map((entry) => entry.fullName)).toEqual([
      "octocat/Api-Client",
      "acme/api",
      "octocat/dotfiles",
      "acme/web",
    ]);
    expect(listed[0]).toEqual({
      id: 2,
      fullName: "octocat/Api-Client",
      owner: "octocat",
      name: "Api-Client",
      private: false,
      defaultBranch: "trunk",
      url: "https://github.com/octocat/Api-Client.git",
      description: "A client",
      pushedAt: Date.parse("2026-09-20T00:00:00Z"),
      canPush: true,
      installationId: MINE,
      projectId: null,
    });
    expect(listed.find((entry) => entry.fullName === "acme/web")?.canPush).toBe(false);
    // The project that is this repository, whatever its remote was written as,
    // and never somebody else's project of the same repository.
    expect(listed.find((entry) => entry.fullName === "acme/api")?.projectId).toBe("prj_repos_api");
    expect(listed.find((entry) => entry.fullName === "acme/web")?.projectId).toBeNull();

    // Asked as the person and never as the installation, and never of the
    // installation that is suspended.
    expect(asked.map((request) => request.url).sort()).toEqual([
      `https://api.github.com/user/installations/${MINE}/repositories?per_page=100&page=1`,
      `https://api.github.com/user/installations/${ORG}/repositories?per_page=100&page=1`,
    ]);
    for (const request of asked) {
      expect(request.headers.get("Authorization")).toBe(`Bearer ${tokenOf(USER)}`);
    }
    expect(asked.some((request) => isTokenRequest(request))).toBe(false);
  });

  it("shows two members of one organisation each their own list", async () => {
    const { fetcher } = githubWorld(world());
    const testEnv = await envOn();
    // The person first, so that what is kept for them would be there to be
    // handed to the colleague if it were kept by installation alone.
    await listRepositories(testEnv, USER, {}, fetcher);
    const colleague = await listRepositories(testEnv, COLLEAGUE, {}, fetcher);
    expect(colleague.map((entry) => entry.fullName)).toEqual(["acme/secrets", "acme/payroll"]);
    const mine = await listRepositories(testEnv, USER, { query: "acme/" }, fetcher);
    expect(mine.map((entry) => entry.fullName)).toEqual(["acme/api", "acme/web"]);
  });

  it("filters by a part of the name, whatever its case, and caps the list", async () => {
    const testEnv = await envOn();
    const { fetcher } = githubWorld(world());
    const api = await listRepositories(testEnv, USER, { query: "  API " }, fetcher);
    expect(api.map((entry) => entry.fullName)).toEqual(["octocat/Api-Client", "acme/api"]);

    // Searching for one that is there and not theirs finds nothing.
    expect(await listRepositories(testEnv, USER, { query: "payroll" }, fetcher)).toEqual([]);
    expect(await listRepositories(testEnv, USER, { limit: 1 }, fetcher)).toHaveLength(1);
    expect(await listRepositories(testEnv, USER, { limit: 0 }, fetcher)).toHaveLength(1);
  });

  it("reads every page, and never more than a hundred entries are answered", async () => {
    const many = Array.from({ length: 230 }, (_, index) =>
      repository(10_000 + index, `octocat/r${index}`, {
        pushed_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      }),
    );
    const { fetcher, asked } = githubWorld({
      installations: { [MINE]: many, [ORG]: [] },
      people: {
        [tokenOf(USER)]: Object.fromEntries(many.map((entry) => [entry.id, { push: true }])),
      },
    });
    const testEnv = await envOn();

    const listed = await listRepositories(testEnv, USER, { limit: 500 }, fetcher);
    expect(listed).toHaveLength(100);
    expect(listed[0]?.fullName).toBe("octocat/r229");
    expect(
      asked
        .filter((request) => request.url.includes(`/installations/${MINE}/`))
        .map((request) => new URL(request.url).searchParams.get("page")),
    ).toEqual(["1", "2", "3"]);
    // Found on the third page, which a single request would never have seen.
    const last = await listRepositories(testEnv, USER, { query: "r0" }, fetcher);
    expect(last.map((entry) => entry.fullName)).toEqual(["octocat/r0"]);
    expect(await listRepositories(testEnv, USER, {}, fetcher)).toHaveLength(50);
  });

  it("fails closed instead of caching an installation list that reaches the page cap", async () => {
    const many = Array.from({ length: 1_000 }, (_, index) =>
      repository(20_000 + index, `octocat/capped-${index}`),
    );
    const { fetcher, asked } = githubWorld({
      installations: { [MINE]: many, [ORG]: [] },
      people: {
        [tokenOf(USER)]: Object.fromEntries(many.map((entry) => [entry.id, { push: true }])),
      },
    });

    await expect(listRepositories(await envOn(), USER, {}, fetcher)).rejects.toMatchObject({
      status: 502,
    });
    expect(asked.filter((request) => request.url.includes(`/installations/${MINE}/`))).toHaveLength(
      10,
    );
    expect(await env.OAUTH_KV.get(repositoriesCacheKey(USER, MINE))).toBeNull();
  });

  it("fails closed when GitHub omits the repository list", async () => {
    const { fetcher } = githubWorld(
      { installations: { [MINE]: [], [ORG]: [] }, people: { [tokenOf(USER)]: {} } },
      (asked) =>
        asked.url.includes(`/installations/${MINE}/repositories`)
          ? Response.json({ message: "temporary provider response" })
          : undefined,
    );

    await expect(listRepositories(await envOn(), USER, {}, fetcher)).rejects.toMatchObject({
      status: 502,
    });
  });

  it("asks GitHub once a minute at most, however often the picker asks", async () => {
    const { fetcher, asked } = githubWorld(world());
    const testEnv = await envOn();
    await listRepositories(testEnv, USER, {}, fetcher);
    const first = asked.length;
    await listRepositories(testEnv, USER, { query: "api" }, fetcher);
    await listRepositories(testEnv, USER, { query: "web" }, fetcher);
    expect(asked.length).toBe(first);
  });

  it("still lists the rest when one installation is gone, and says so when none is left", async () => {
    const { [MINE]: _gone, ...rest } = world().installations;
    const partly = githubWorld({ ...world(), installations: rest });
    const listed = await listRepositories(await envOn(), USER, {}, partly.fetcher);
    expect(listed.map((entry) => entry.fullName)).toEqual(["acme/api", "acme/web"]);

    for (const id of [MINE, ORG]) await env.OAUTH_KV.delete(repositoriesCacheKey(USER, id));
    const nothing = githubWorld({ ...world(), installations: {} });
    await expect(listRepositories(await envOn(), USER, {}, nothing.fetcher)).rejects.toMatchObject({
      name: "GitHubError",
      status: 404,
    });
  });

  it("asks the account to connect again once GitHub refuses its token", async () => {
    const { fetcher } = githubWorld({ ...world(), people: {} });
    await expect(listRepositories(await envOn(), USER, {}, fetcher)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );
    expect(await hasUserToken(env, USER)).toBe(false);
  });

  it("is empty, and asks nothing, where the connection is off", async () => {
    const { fetcher, asked } = githubWorld(world());
    expect(await listRepositories(envOff(), USER, {}, fetcher)).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("a repository that was picked", () => {
  it("is read from GitHub, as the person and then as the installation", async () => {
    const { fetcher, asked } = githubWorld(world());
    const picked = await pickedRepository(
      await envOn(),
      USER,
      { repositoryId: 4, installationId: ORG },
      fetcher,
    );
    expect(picked).toMatchObject({
      id: 4,
      fullName: "acme/web",
      name: "web",
      url: "https://github.com/acme/web.git",
      installationId: ORG,
      canPush: false,
    });
    expect(asked.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /repositories/4",
      `POST /app/installations/${ORG}/access_tokens`,
      "GET /repositories/4",
    ]);
    expect(asked[0]?.headers.get("Authorization")).toBe(`Bearer ${tokenOf(USER)}`);
    expect(asked[1]?.body).toEqual({ repository_ids: [4], permissions: { metadata: "read" } });
  });

  it("is nothing to a person who cannot open it, though the installation holds it", async () => {
    const { fetcher, asked } = githubWorld(world());
    const picked = await pickedRepository(
      await envOn(),
      USER,
      { repositoryId: 5, installationId: ORG },
      fetcher,
    );
    expect(picked).toBeNull();
    // And no token was minted in the installation's name to find that out.
    expect(asked.some((request) => isTokenRequest(request))).toBe(false);
  });

  it("is refused in an installation that does not hold it, or that is not the account's", async () => {
    const { fetcher, asked } = githubWorld(world());
    // The person can open it, and it is in their own installation, not this one.
    await expect(
      pickedRepository(await envOn(), USER, { repositoryId: 1, installationId: ORG }, fetcher),
    ).rejects.toMatchObject({ status: 422 });

    const before = asked.length;
    expect(
      await pickedRepository(
        await envOn(),
        COLLEAGUE,
        { repositoryId: 1, installationId: MINE },
        fetcher,
      ),
    ).toBeNull();
    expect(
      await pickedRepository(
        await envOn(),
        USER,
        { repositoryId: 7, installationId: SUSPENDED },
        fetcher,
      ),
    ).toBeNull();
    expect(asked.length).toBe(before);
  });
});

describe("a project's name", () => {
  it("is taken from its repository", () => {
    expect(projectSlug("Api-Client")).toBe("api-client");
    expect(projectSlug(".github")).toBe("github");
    expect(projectSlug("My_Repo.js")).toBe("my-repo-js");
    expect(projectSlug("___")).toBe("project");
    expect(projectSlug("a".repeat(80))).toHaveLength(60);
  });
});

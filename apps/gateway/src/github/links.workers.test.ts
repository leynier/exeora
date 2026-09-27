import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { accessCacheKey } from "./access.js";
import { GitHubReconnectError } from "./app.js";
import { authorize, envOn, githubWorld, repository, tokenOf, type World } from "./fixtures.js";
import { linkByRepository, linkMatching, linkProject } from "./links.js";
import { repositoriesCacheKey } from "./repositories.js";

/**
 * Linking a project to a repository, which is what lets a machine ask for a
 * token: never for a repository its owner cannot read.
 */

const USER = "usr_github_links";
const OTHER = "usr_github_links_other";
const ORG = 5201;

const API = { installationId: ORG, id: 3, fullName: "acme/api", private: false };
const PAYROLL = { installationId: ORG, id: 5, fullName: "acme/payroll", private: true };

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    await env.OAUTH_KV.delete(repositoriesCacheKey(id, ORG));
    for (const repo of [3, 5]) await env.OAUTH_KV.delete(accessCacheKey(id, repo));
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-links@example.com" },
      { id: OTHER, email: "github-links-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_links",
      userId: USER,
      installationId: ORG,
      accountLogin: "acme",
      accountType: "Organization",
    })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: "dev_links", userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_links_other", userId: OTHER, name: "laptop", platform: "linux" },
    ])
    .run();
  const project = (id: string, userId: string, deviceId: string, name: string) => ({
    id,
    userId,
    deviceId,
    name,
    slug: name,
    localPath: `/w/${name}`,
    repoUrl: `https://github.com/acme/${name}.git`,
    repoKey: `github.com/acme/${name}`,
  });
  await database
    .insert(schema.projects)
    .values([
      project("prj_links_api", USER, "dev_links", "api"),
      // A checkout of a repository the person has since lost sight of.
      project("prj_links_payroll", USER, "dev_links", "payroll"),
      project("prj_links_foreign", OTHER, "dev_links_other", "api"),
    ])
    .run();
  await authorize(USER);
  await authorize(OTHER);
});

/** The installation holds both. The person can open one. */
const world = (): World => ({
  installations: { [ORG]: [repository(3, "acme/api"), repository(5, "acme/payroll")] },
  people: { [tokenOf(USER)]: { 3: { push: true } }, [tokenOf(OTHER)]: { 3: { push: true } } },
});

const links = () =>
  db(env)
    .select()
    .from(schema.githubRepositories)
    .orderBy(schema.githubRepositories.projectId)
    .all();

describe("linking projects to repositories", () => {
  it("connects the projects the account already had, as far as the person can read them", async () => {
    const { fetcher } = githubWorld(world());
    expect(await linkByRepository(await envOn(), USER, fetcher)).toBe(1);
    // `prj_links_payroll` is a repository of the installation too, and stays
    // unlinked: the person is not shown it.
    expect(await links()).toMatchObject([
      {
        projectId: "prj_links_api",
        userId: USER,
        installationId: ORG,
        repoId: 3,
        fullName: "acme/api",
        private: false,
        lostAccessAt: null,
      },
    ]);
    // Again changes nothing: the link that works is left as it is.
    expect(await linkByRepository(await envOn(), USER, fetcher)).toBe(0);
  });

  it("gives back the access of a project that had lost it", async () => {
    await db(env)
      .insert(schema.githubRepositories)
      .values({
        projectId: "prj_links_api",
        userId: USER,
        installationId: 1,
        repoId: 3,
        fullName: "acme/old-name",
        lostAccessAt: new Date(),
      })
      .run();
    const { fetcher } = githubWorld(world());
    expect(await linkByRepository(await envOn(), USER, fetcher)).toBe(1);
    expect(await links()).toMatchObject([
      { installationId: ORG, fullName: "acme/api", lostAccessAt: null },
    ]);
  });

  it("will not link a repository the person cannot read", async () => {
    const { fetcher, asked } = githubWorld(world());
    const testEnv = await envOn();
    expect(await linkProject(testEnv, USER, "prj_links_payroll", PAYROLL, fetcher)).toBe(false);
    expect(await links()).toEqual([]);
    // Asked of GitHub as the person, about that repository.
    expect(asked.map((request) => request.url)).toEqual(["https://api.github.com/repositories/5"]);
    expect(asked[0]?.headers.get("Authorization")).toBe(`Bearer ${tokenOf(USER)}`);

    expect(await linkProject(testEnv, USER, "prj_links_api", API, fetcher)).toBe(true);
    expect(await links()).toMatchObject([{ projectId: "prj_links_api", repoId: 3 }]);
  });

  it("asks again each time, whatever was true ten minutes ago", async () => {
    const testEnv = await envOn();
    const before = githubWorld(world());
    expect(await linkProject(testEnv, USER, "prj_links_api", API, before.fetcher)).toBe(true);
    await db(env).delete(schema.githubRepositories).run();

    // Taken out of the team since.
    const after = githubWorld({ ...world(), people: { [tokenOf(USER)]: {} } });
    expect(await linkProject(testEnv, USER, "prj_links_api", API, after.fetcher)).toBe(false);
    expect(await links()).toEqual([]);
  });

  it("writes nothing for a project of another account", async () => {
    const { fetcher } = githubWorld(world());
    const testEnv = await envOn();
    expect(await linkProject(testEnv, USER, "prj_links_foreign", API, fetcher)).toBe(false);
    expect(await links()).toEqual([]);
    expect(await linkProject(testEnv, OTHER, "prj_links_foreign", API, fetcher)).toBe(true);
  });

  it("checks each repository it was only told about", async () => {
    // What a webhook names: added to the installation, which says nothing
    // of who may read it.
    const added = [API, PAYROLL].map((entry) => ({
      ...entry,
      url: `https://github.com/${entry.fullName}.git`,
    }));
    const { fetcher, asked } = githubWorld(world());
    expect(await linkMatching(await envOn(), USER, added, fetcher, { listedForUser: false })).toBe(
      1,
    );
    expect((await links()).map((link) => link.projectId)).toEqual(["prj_links_api"]);
    expect(asked.map((request) => request.url).sort()).toEqual([
      "https://api.github.com/repositories/3",
      "https://api.github.com/repositories/5",
    ]);
  });

  it("links nothing for an account that has to connect again", async () => {
    const { fetcher } = githubWorld({ ...world(), people: {} });
    await expect(
      linkProject(await envOn(), USER, "prj_links_api", API, fetcher),
    ).rejects.toBeInstanceOf(GitHubReconnectError);
    await expect(linkByRepository(await envOn(), USER, fetcher)).rejects.toBeInstanceOf(
      GitHubReconnectError,
    );
    expect(await links()).toEqual([]);
  });
});

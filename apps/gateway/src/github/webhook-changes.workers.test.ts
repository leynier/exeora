import { createExecutionContext, env, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { accessCacheKey } from "./access.js";
import {
  type Asked,
  authorize,
  call,
  envOn,
  fakeGitHub,
  isTokenRequest,
  minted,
  repository,
  signature,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { repositoriesCacheKey } from "./repositories.js";
import { hasUserToken } from "./user-token.js";

/**
 * The deliveries that say less than what happened, or whose consequences
 * reach further than the row they name: an installation cut down to a chosen
 * few, a repository renamed under machines that cloned it, and a person
 * taking their authorization back.
 */

const USER = "usr_github_changes";
const OTHER = "usr_github_changes_other";
const INSTALLATION = 7301;
const ELSEWHERE = 7302;

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-changes@example.com", cloudEnabled: true },
      { id: OTHER, email: "github-changes-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.githubInstallations)
    .values([
      {
        id: "ghi_changes",
        userId: USER,
        installationId: INSTALLATION,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "all",
      },
      {
        id: "ghi_changes_elsewhere",
        userId: USER,
        installationId: ELSEWHERE,
        accountLogin: "globex",
        accountType: "Organization",
      },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: "dev_changes", userId: USER, name: "laptop", platform: "linux" })
    .run();
  const project = (id: string, name: string) => ({
    id,
    userId: USER,
    deviceId: "dev_changes",
    name,
    slug: name,
    localPath: `/w/${name}`,
    repoUrl: `https://github.com/acme/${name}.git`,
    repoKey: `github.com/acme/${name}`,
  });
  await database
    .insert(schema.projects)
    .values([
      project("prj_changes_api", "api"),
      project("prj_changes_web", "web"),
      project("prj_changes_docs", "docs"),
      project("prj_changes_other", "other"),
    ])
    .run();
  const link = (projectId: string, installationId: number, repoId: number, name: string) => ({
    projectId,
    userId: USER,
    installationId,
    repoId,
    fullName: `acme/${name}`,
  });
  await database
    .insert(schema.githubRepositories)
    .values([
      link("prj_changes_api", INSTALLATION, 71, "api"),
      link("prj_changes_web", INSTALLATION, 72, "web"),
      link("prj_changes_docs", INSTALLATION, 73, "docs"),
      // The same account, through another installation.
      link("prj_changes_other", ELSEWHERE, 74, "other"),
    ])
    .run();
});

async function deliver(event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return worker.fetch(
    new Request("https://exeora.dev/api/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-GitHub-Event": event,
        "X-Hub-Signature-256": await signature(body),
      },
      body,
    }),
    await envOn(),
    createExecutionContext(),
  );
}

/** GitHub, where the installation holds exactly `held`, a hundred to the page. */
function holding(held: number[], first?: (asked: Asked) => Response | undefined) {
  const fake = fakeGitHub((asked) => {
    const earlier = first?.(asked);
    if (earlier) return earlier;
    if (isTokenRequest(asked, INSTALLATION)) return minted("ghs_reconcile");
    const url = new URL(asked.url);
    if (url.pathname !== "/installation/repositories") return undefined;
    const page = Number(url.searchParams.get("page") ?? "1");
    return Response.json({
      total_count: held.length,
      repositories: held
        .slice((page - 1) * 100, page * 100)
        .map((id) => repository(id, `acme/r${id}`)),
    });
  });
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const lostLinks = async () =>
  (await db(env).select().from(schema.githubRepositories).all())
    .filter((link) => link.lostAccessAt !== null)
    .map((link) => link.projectId)
    .sort();

const narrowed = {
  action: "removed",
  installation: { id: INSTALLATION },
  repository_selection: "selected",
  repositories_added: [],
  repositories_removed: [],
};

describe("an installation cut down to a chosen few", () => {
  it("is asked what it still holds, since the delivery names nothing that left", async () => {
    const { asked } = holding([71]);
    const response = await deliver("installation_repositories", narrowed);
    expect(response.status).toBe(200);

    // Everything of that installation that is not there any more, and
    // nothing of the account's other one.
    expect(await lostLinks()).toEqual(["prj_changes_docs", "prj_changes_web"]);
    expect(asked.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      `POST /app/installations/${INSTALLATION}/access_tokens`,
      "GET /installation/repositories",
    ]);
    expect(asked[0]?.body).toEqual({ permissions: { metadata: "read" } });
    const [installation] = await db(env)
      .select()
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.id, "ghi_changes"))
      .all();
    expect(installation?.repositorySelection).toBe("selected");
  });

  it("reconciles as well when it names some of what left", async () => {
    // Told about one. Two are gone.
    holding([71]);
    await deliver("installation_repositories", {
      ...narrowed,
      repositories_removed: [{ id: 72, full_name: "acme/web", private: false }],
    });
    expect(await lostLinks()).toEqual(["prj_changes_docs", "prj_changes_web"]);
  });

  it("reads every page before it calls anything gone", async () => {
    // The repository that is still linked is the last of two hundred and one.
    const many = [...Array.from({ length: 200 }, (_, index) => 10_000 + index), 72];
    const { asked } = holding(many);
    await deliver("installation_repositories", narrowed);
    expect(await lostLinks()).toEqual(["prj_changes_api", "prj_changes_docs"]);
    expect(asked.filter((request) => request.method === "GET")).toHaveLength(3);
  });

  it("takes nothing away when GitHub cannot say what is left, and says the delivery failed", async () => {
    holding([], (asked) =>
      asked.url.includes("/installation/repositories")
        ? Response.json({ message: "Server Error" }, { status: 500 })
        : undefined,
    );
    const response = await deliver("installation_repositories", narrowed);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "github_unavailable" });
    expect(await lostLinks()).toEqual([]);
  });

  it("asks nothing for an installation nothing is linked through", async () => {
    await db(env).delete(schema.githubRepositories).run();
    const { asked } = holding([]);
    expect((await deliver("installation_repositories", narrowed)).status).toBe(200);
    expect(asked).toEqual([]);
  });
});

describe("a repository renamed under a project on Exeora Cloud", () => {
  const cloud = (projectId: string) =>
    db(env)
      .select()
      .from(schema.cloudProjects)
      .where(eq(schema.cloudProjects.projectId, projectId))
      .get();

  const rename = (fullName: string) =>
    deliver("repository", {
      action: "renamed",
      installation: { id: INSTALLATION },
      repository: { id: 71, full_name: fullName, private: false },
    });

  beforeEach(async () => {
    await db(env)
      .insert(schema.cloudProjects)
      .values([
        {
          projectId: "prj_changes_api",
          userId: USER,
          repoUrl: "https://github.com/acme/api.git",
          defaultBranch: "main",
        },
        {
          projectId: "prj_changes_web",
          userId: USER,
          repoUrl: "https://github.com/acme/web.git",
          defaultBranch: "main",
        },
      ])
      .run();
  });

  it("moves the address machines clone, and keeps the one they cloned", async () => {
    expect((await rename("acme/platform")).status).toBe(200);
    expect(await cloud("prj_changes_api")).toMatchObject({
      repoUrl: "https://github.com/acme/platform.git",
      previousRepoUrls: JSON.stringify(["https://github.com/acme/api.git"]),
    });
    expect(
      await db(env)
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, "prj_changes_api"))
        .get(),
    ).toMatchObject({
      repoUrl: "https://github.com/acme/platform.git",
      repoKey: "github.com/acme/platform",
    });
    // Another repository's project is left as it was.
    expect(await cloud("prj_changes_web")).toMatchObject({
      repoUrl: "https://github.com/acme/web.git",
      previousRepoUrls: null,
    });
  });

  it("remembers each address it had, once, and none that it has now", async () => {
    await rename("acme/platform");
    await rename("globex/platform");
    // Delivered twice, as GitHub may.
    await rename("globex/platform");
    expect(await cloud("prj_changes_api")).toMatchObject({
      repoUrl: "https://github.com/globex/platform.git",
      previousRepoUrls: JSON.stringify([
        "https://github.com/acme/api.git",
        "https://github.com/acme/platform.git",
      ]),
    });

    // Back to the name it started with.
    await rename("acme/api");
    expect(await cloud("prj_changes_api")).toMatchObject({
      repoUrl: "https://github.com/acme/api.git",
      previousRepoUrls: JSON.stringify([
        "https://github.com/acme/platform.git",
        "https://github.com/globex/platform.git",
      ]),
    });
  });

  it("tells the next machine where the repository is, and where it used to be", async () => {
    await authorize(USER);
    await rename("acme/platform");
    const response = await call("/api/cloud/projects/prj_changes_api/workspaces", {
      body: { branch: "feature/after-rename" },
      userId: USER,
      env: await envOn(),
    });
    expect(response.status).toBe(202);
    const { deviceId } = (await response.json()) as { deviceId: string };
    const input = await runInDurableObject(
      env.CLOUD_MACHINE.getByName(deviceId),
      (_instance, state) =>
        state.storage.get<{ repoUrl: string; previousRepoUrls?: string[] }>("input"),
    );
    expect(input).toMatchObject({
      repoUrl: "https://github.com/acme/platform.git",
      previousRepoUrls: ["https://github.com/acme/api.git"],
    });

    // A project that was never renamed says nothing of earlier addresses.
    const other = await call("/api/cloud/projects/prj_changes_web/workspaces", {
      body: { branch: "feature/plain" },
      userId: USER,
      env: await envOn(),
    });
    const plain = (await other.json()) as { deviceId: string };
    const untouched = await runInDurableObject(
      env.CLOUD_MACHINE.getByName(plain.deviceId),
      (_instance, state) => state.storage.get<{ previousRepoUrls?: string[] }>("input"),
    );
    expect(untouched?.previousRepoUrls).toBeUndefined();
  });
});

describe("a person taking their authorization back", () => {
  const revoked = (sender: Record<string, unknown>) =>
    deliver("github_app_authorization", { action: "revoked", sender });

  it("forgets their token at once, so the account is told to connect again", async () => {
    await authorize(USER, { login: "octocat", githubUserId: 583_231 });
    await authorize(OTHER, { login: "hubot", githubUserId: 480_938 });
    await env.OAUTH_KV.put(accessCacheKey(USER, 71), JSON.stringify({ pull: true, push: true }));
    await env.OAUTH_KV.put(repositoriesCacheKey(USER, INSTALLATION), "[]");

    // Under a new name since they connected: it is the id that says who.
    const response = await revoked({ login: "octocat-renamed", id: 583_231 });
    expect(response.status).toBe(200);

    expect(await hasUserToken(env, USER)).toBe(false);
    expect(await hasUserToken(env, OTHER)).toBe(true);
    const status = await call("/api/github", { userId: USER, env: await envOn() });
    expect(await status.json()).toMatchObject({ connected: false, reconnect: true });
    // What was remembered of their access is not used for another ten minutes.
    expect(await env.OAUTH_KV.get(accessCacheKey(USER, 71))).toBeNull();
    expect(await env.OAUTH_KV.get(repositoriesCacheKey(USER, INSTALLATION))).toBeNull();
    // The installation is the organisation's, and stays.
    expect(
      await db(env)
        .select()
        .from(schema.githubInstallations)
        .where(eq(schema.githubInstallations.userId, USER))
        .all(),
    ).toHaveLength(2);
  });

  it("goes by the name only for an account connected before the id was kept", async () => {
    await authorize(USER, { login: "Octocat", githubUserId: null });
    // The name was given up and taken by somebody else, whose id is kept.
    await authorize(OTHER, { login: "octocat", githubUserId: 999 });

    expect((await revoked({ login: "octocat", id: 583_231 })).status).toBe(200);
    expect(await hasUserToken(env, USER)).toBe(false);
    expect(await hasUserToken(env, OTHER)).toBe(true);
  });

  it("changes nothing for somebody no account is connected as, or for another action", async () => {
    await authorize(USER, { login: "octocat", githubUserId: 583_231 });
    expect((await revoked({ login: "stranger", id: 1 })).status).toBe(200);
    expect((await revoked({})).status).toBe(204);
    const other = await deliver("github_app_authorization", {
      action: "created",
      sender: { login: "octocat", id: 583_231 },
    });
    expect(other.status).toBe(204);
    expect(await hasUserToken(env, USER)).toBe(true);
  });
});

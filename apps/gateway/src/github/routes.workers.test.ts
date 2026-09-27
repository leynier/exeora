import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { isExecutorApiRequest, isMachineApiRequest } from "../oauth/scopes.js";
import { limiterFor } from "../rate-limit.js";
import {
  authorize,
  CLI,
  call,
  envOff,
  envOn,
  fakeGitHub,
  githubWorld,
  repository,
  tokenOf,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { repositoriesCacheKey } from "./repositories.js";
import { verifyConnectState } from "./state.js";

/** GitHub as the dashboard and the CLI reach it. The way back from github.com has a file of its own. */

const USER = "usr_github_routes";
const OTHER = "usr_github_routes_other";
const INSTALLATION = 8101;

let restore: (() => void) | undefined;

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await env.OAUTH_KV.delete(repositoriesCacheKey(USER, INSTALLATION));
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-routes@example.com" },
      { id: OTHER, email: "github-routes-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: "dev_gh_routes", userId: USER, name: "laptop", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: "prj_gh_routes",
      userId: USER,
      deviceId: "dev_gh_routes",
      name: "api",
      slug: "api",
      localPath: "/w/api",
      repoUrl: "https://github.com/octocat/api.git",
      repoKey: "github.com/octocat/api",
    })
    .run();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

/** One installation holding three repositories, of which the person can open two. */
function github(people = { [tokenOf(USER)]: { 41: { push: true }, 42: { push: false } } }) {
  const fake = githubWorld({
    installations: {
      [INSTALLATION]: [
        repository(41, "octocat/api"),
        repository(42, "octocat/web"),
        repository(43, "octocat/private-notes", { private: true }),
      ],
    },
    people,
  });
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

/** Holds an installation, with or without the token that makes it usable. */
async function connected(options: { authorized?: boolean } = {}) {
  await db(env)
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_routes",
      userId: USER,
      installationId: INSTALLATION,
      accountLogin: "octocat",
      accountType: "User",
    })
    .run();
  if (options.authorized !== false) await authorize(USER);
}

const installations = (userId: string) =>
  db(env)
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.userId, userId))
    .all();

describe("a gateway without the app", () => {
  it("says the connection is off, in the shape each caller expects", async () => {
    const off = envOff();
    const status = await call("/api/github", { userId: USER, env: off });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      enabled: false,
      connected: false,
      reconnect: false,
      installations: [],
      connectUrl: null,
    });

    const listing = await call("/api/github/repositories", { userId: USER, env: off });
    expect(listing.status).toBe(200);
    expect(await listing.json()).toEqual({ connected: false, enabled: false, repositories: [] });

    const callback = await worker.fetch(
      new Request("https://exeora.dev/api/github/callback?code=c&installation_id=1&state=s"),
      off,
      createExecutionContext(),
    );
    const refused = [
      await call("/api/github/connect", { userId: USER, env: off }),
      await call("/api/github/installations/ghi_x", { method: "DELETE", userId: USER, env: off }),
      await call("/api/projects/prj_gh_routes/git-credential", {
        method: "POST",
        userId: USER,
        scopes: CLI,
        env: off,
      }),
      callback,
    ];
    for (const response of refused) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "github_disabled" });
    }
  });

  it("is off as well with the app and nowhere safe to keep a person's token", async () => {
    await connected();
    const keyless = await envOn({ CLOUD_CREDENTIALS_KEY: undefined });
    const status = await call("/api/github", { userId: USER, env: keyless });
    expect(await status.json()).toMatchObject({ enabled: false, connected: false });
    const credential = await call("/api/projects/prj_gh_routes/git-credential", {
      method: "POST",
      userId: USER,
      scopes: CLI,
      env: keyless,
    });
    expect(credential.status).toBe(404);
    expect(await credential.json()).toEqual({ error: "github_disabled" });
  });
});

describe("GET /api/github", () => {
  it("hands out GitHub's own address, with a state signed for the account", async () => {
    const testEnv = await envOn();
    const response = await call("/api/github", { userId: USER, env: testEnv });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { connectUrl: string; connected: boolean };
    expect(body).toMatchObject({
      enabled: true,
      connected: false,
      reconnect: false,
      installations: [],
    });

    const url = new URL(body.connectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/apps/exeora-test/installations/new",
    );
    expect(await verifyConnectState(testEnv, url.searchParams.get("state") ?? "")).toMatchObject({
      userId: USER,
    });

    const redirect = await call("/api/github/connect", { userId: USER, env: testEnv });
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get("location") ?? "");
    expect(location.hostname).toBe("github.com");
    expect(
      await verifyConnectState(testEnv, location.searchParams.get("state") ?? ""),
    ).toMatchObject({ userId: USER });
  });

  it("lists what the account holds and lets it let go of one", async () => {
    await connected();
    const testEnv = await envOn();
    const response = await call("/api/github", { userId: USER, scopes: CLI, env: testEnv });
    expect(await response.json()).toMatchObject({
      enabled: true,
      connected: true,
      reconnect: false,
      installations: [
        {
          id: "ghi_routes",
          installationId: INSTALLATION,
          accountLogin: "octocat",
          accountType: "User",
          repositorySelection: "selected",
          suspended: false,
          manageUrl: `https://github.com/settings/installations/${INSTALLATION}`,
        },
      ],
    });

    const foreign = await call("/api/github/installations/ghi_routes", {
      method: "DELETE",
      userId: OTHER,
      env: testEnv,
    });
    expect(foreign.status).toBe(404);
    const removed = await call("/api/github/installations/ghi_routes", {
      method: "DELETE",
      userId: USER,
      env: testEnv,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      ok: true,
      manageUrl: `https://github.com/settings/installations/${INSTALLATION}`,
    });
    expect(await installations(USER)).toEqual([]);
  });

  it("asks an account whose authorization is gone to connect again", async () => {
    // Holds the installation, from before tokens were kept or since GitHub
    // stopped accepting the one it had.
    await connected({ authorized: false });
    const testEnv = await envOn();
    const status = await call("/api/github", { userId: USER, env: testEnv });
    const body = (await status.json()) as { connectUrl: string };
    expect(body).toMatchObject({
      enabled: true,
      connected: false,
      reconnect: true,
      installations: [{ id: "ghi_routes" }],
    });
    expect(body.connectUrl).toContain("https://github.com/apps/exeora-test/installations/new");

    const { asked } = github();
    const listing = await call("/api/github/repositories", { userId: USER, env: testEnv });
    expect(listing.status).toBe(409);
    expect(await listing.json()).toEqual({
      error: "github_reconnect",
      message:
        "GitHub no longer accepts this account's authorization. Connect GitHub again from the settings.",
    });
    expect(asked).toEqual([]);
    // Letting go of the installation needs nothing from GitHub, and works.
    const removed = await call("/api/github/installations/ghi_routes", {
      method: "DELETE",
      userId: USER,
      env: testEnv,
    });
    expect(removed.status).toBe(200);
  });

  it("finds out that GitHub refuses the token, and says so from then on", async () => {
    await connected();
    github({});
    const testEnv = await envOn();
    const listing = await call("/api/github/repositories", { userId: USER, env: testEnv });
    expect(listing.status).toBe(409);
    expect(await listing.json()).toMatchObject({ error: "github_reconnect" });

    const status = await call("/api/github", { userId: USER, env: testEnv });
    expect(await status.json()).toMatchObject({ connected: false, reconnect: true });
  });
});

describe("GET /api/github/repositories", () => {
  it("answers an account that is not connected without asking GitHub", async () => {
    const { asked } = github();
    const response = await call("/api/github/repositories", { userId: USER, env: await envOn() });
    expect(await response.json()).toEqual({ enabled: true, connected: false, repositories: [] });
    expect(asked).toEqual([]);
  });

  it("lists what the person can open, filters and caps from the query", async () => {
    github();
    await connected();
    const testEnv = await envOn();
    const all = await call("/api/github/repositories", { userId: USER, scopes: CLI, env: testEnv });
    const body = (await all.json()) as { repositories: Array<{ fullName: string }> };
    expect(body).toMatchObject({
      enabled: true,
      connected: true,
      repositories: [
        {
          fullName: "octocat/api",
          projectId: "prj_gh_routes",
          installationId: INSTALLATION,
          canPush: true,
        },
        { fullName: "octocat/web", projectId: null, canPush: false },
      ],
    });
    // In the installation, and not the person's to see.
    expect(body.repositories.map((entry) => entry.fullName)).not.toContain("octocat/private-notes");
    const one = await call("/api/github/repositories?q=WEB&limit=5", {
      userId: USER,
      env: testEnv,
    });
    expect(await one.json()).toMatchObject({ repositories: [{ fullName: "octocat/web" }] });
  });

  it("says so, in words, when GitHub does not answer", async () => {
    restore = replaceOutbound(fakeGitHub(() => Response.json({}, { status: 503 })).fetcher);
    await connected();
    const response = await call("/api/github/repositories", { userId: USER, env: await envOn() });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "github_unavailable" });
  });
});

describe("who may reach what", () => {
  it("opens the listing and the credential to the CLI, and only the credential to a machine", () => {
    expect(isExecutorApiRequest("GET", "/api/github")).toBe(true);
    expect(isExecutorApiRequest("GET", "/api/github/repositories")).toBe(true);
    expect(isExecutorApiRequest("POST", "/api/projects/prj_1/git-credential")).toBe(true);
    expect(isExecutorApiRequest("GET", "/api/github/connect")).toBe(false);
    expect(isExecutorApiRequest("DELETE", "/api/github/installations/ghi_1")).toBe(false);
    expect(isExecutorApiRequest("GET", "/api/projects/prj_1/git-credential")).toBe(false);

    expect(isMachineApiRequest("POST", "/api/projects/prj_1/git-credential")).toBe(true);
    expect(isMachineApiRequest("POST", "/api/projects/prj_1/git-credential/more")).toBe(false);
    expect(isMachineApiRequest("GET", "/api/github")).toBe(false);
    expect(isMachineApiRequest("GET", "/api/github/repositories")).toBe(false);
    expect(isMachineApiRequest("POST", "/api/projects")).toBe(false);
  });

  it("keeps a machine token away from the account's connection", async () => {
    const testEnv = await envOn();
    for (const path of ["/api/github", "/api/github/repositories"]) {
      const response = await call(path, {
        userId: USER,
        scopes: CLI,
        deviceId: "dev_some_machine",
        env: testEnv,
      });
      expect(response.status).toBe(403);
    }
  });

  it("counts a credential as a write", () => {
    expect(limiterFor(env, "POST", "/api/projects/prj_1/git-credential")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "GET", "/api/github/repositories")).toBeUndefined();
  });
});

import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { cloneCredential } from "../workspace-placement.js";
import { accessCacheKey } from "./access.js";
import {
  type Asked,
  authorize,
  CLI,
  call,
  DASHBOARD,
  envOff,
  envOn,
  githubWorld,
  isTokenRequest,
  minted,
  repository,
  tokenOf,
  type World,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { hasUserToken } from "./user-token.js";

/**
 * The credential route, which hands out the one thing here that can push.
 * Most of these are about who is refused.
 */

const USER = "usr_github_cred";
const OTHER = "usr_github_cred_other";
const INSTALLATION = 9101;
const PROJECT = "prj_cred_api";
const SECOND = "prj_cred_web";
const FOREIGN = "prj_cred_foreign";
const MACHINE = "dev_cred_machine";
const MACHINE_OF_SECOND = "dev_cred_machine_second";
const PATH = `/api/projects/${PROJECT}/git-credential`;

let restore: (() => void) | undefined;

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    for (const repo of [51, 52, 53]) await env.OAUTH_KV.delete(accessCacheKey(id, repo));
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-cred@example.com" },
      { id: OTHER, email: "github-cred-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: "dev_cred_laptop", userId: USER, name: "laptop", platform: "linux" },
      {
        id: "dev_cred_revoked",
        userId: USER,
        name: "old laptop",
        platform: "linux",
        revokedAt: new Date(),
      },
      { id: MACHINE, userId: USER, name: "api (main)", platform: "linux", kind: "cloud" },
      { id: MACHINE_OF_SECOND, userId: USER, name: "web (main)", platform: "linux", kind: "cloud" },
      { id: "dev_cred_foreign", userId: OTHER, name: "laptop", platform: "linux" },
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
      project(PROJECT, USER, "dev_cred_laptop", "api"),
      project(SECOND, USER, "dev_cred_laptop", "web"),
      project(FOREIGN, OTHER, "dev_cred_foreign", "secret"),
    ])
    .run();
  await database
    .insert(schema.cloudMachines)
    .values([
      { deviceId: MACHINE, userId: USER, projectId: PROJECT, spriteName: "exeora-cred-one" },
      {
        deviceId: MACHINE_OF_SECOND,
        userId: USER,
        projectId: SECOND,
        spriteName: "exeora-cred-two",
      },
    ])
    .run();
  await database
    .insert(schema.githubInstallations)
    .values([
      {
        id: "ghi_cred",
        userId: USER,
        installationId: INSTALLATION,
        accountLogin: "acme",
        accountType: "Organization",
      },
      {
        id: "ghi_cred_other",
        userId: OTHER,
        installationId: INSTALLATION,
        accountLogin: "acme",
        accountType: "Organization",
      },
    ])
    .run();
  const link = (projectId: string, userId: string, repoId: number, name: string) => ({
    projectId,
    userId,
    installationId: INSTALLATION,
    repoId,
    fullName: `acme/${name}`,
    private: true,
  });
  await database
    .insert(schema.githubRepositories)
    .values([
      link(PROJECT, USER, 51, "api"),
      link(SECOND, USER, 52, "web"),
      link(FOREIGN, OTHER, 53, "secret"),
    ])
    .run();
  await authorize(USER);
  await authorize(OTHER);
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

/** The organisation's installation holds all three. Each person can open their own. */
const world = (): World => ({
  installations: {
    [INSTALLATION]: [
      repository(51, "acme/api", { private: true }),
      repository(52, "acme/web", { private: true }),
      repository(53, "acme/secret", { private: true }),
    ],
  },
  people: {
    [tokenOf(USER)]: { 51: { push: true }, 52: { push: true } },
    [tokenOf(OTHER)]: { 53: { push: true } },
  },
});

function github(changed: Partial<World> = {}, first?: (asked: Asked) => Response | undefined) {
  const fake = githubWorld({ ...world(), ...changed }, first);
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const ask = async (
  path: string,
  options: { userId?: string; scopes?: string[]; deviceId?: string; body?: unknown } = {},
) =>
  call(path, {
    method: "POST",
    userId: options.userId ?? USER,
    scopes: options.scopes ?? CLI,
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(options.body === undefined ? {} : { body: options.body }),
    env: await envOn(),
  });

const minting = (asked: Asked[]) => asked.filter((request) => isTokenRequest(request));

const link = (projectId: string) =>
  db(env)
    .select()
    .from(schema.githubRepositories)
    .where(eq(schema.githubRepositories.projectId, projectId))
    .get();

describe("POST /api/projects/:id/git-credential", () => {
  it("answers the person's CLI with a token for that one repository", async () => {
    const { asked } = github();
    const response = await ask(PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { expiresAt: number; password: string };
    expect(body).toEqual({
      host: "github.com",
      username: "x-access-token",
      password: expect.stringMatching(/^ghs_/),
      expiresAt: expect.any(Number),
    });
    expect(body.expiresAt).toBeGreaterThan(Date.now() + 50 * 60_000);

    // First whether the person can still read it, asked as them. Then the
    // token, narrowed to the project's repository: the installation holds others.
    expect(asked.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET https://api.github.com/repositories/51",
      `POST https://api.github.com/app/installations/${INSTALLATION}/access_tokens`,
    ]);
    expect(asked[0]?.headers.get("Authorization")).toBe(`Bearer ${tokenOf(USER)}`);
    expect(asked[1]?.body).toEqual({
      repository_ids: [51],
      permissions: { contents: "write", metadata: "read", pull_requests: "write" },
    });
  });

  it("answers a cloud machine for the project it was made for, and no other", async () => {
    const { asked } = github();
    const own = await ask(PATH, { deviceId: MACHINE });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ password: expect.stringMatching(/^ghs_/) });

    // The same account's machine, made for another of its projects.
    const another = await ask(PATH, { deviceId: MACHINE_OF_SECOND });
    expect(another.status).toBe(403);
    expect(await another.json()).toEqual({ error: "forbidden" });
    // A device id that is no machine at all.
    expect((await ask(PATH, { deviceId: "dev_cred_laptop" })).status).toBe(403);
    expect(minting(asked)).toHaveLength(1);
  });

  it("refuses the project of another account", async () => {
    const { asked } = github();
    const response = await ask(`/api/projects/${FOREIGN}/git-credential`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    // Nor does a machine reach across accounts.
    expect(
      (await ask(`/api/projects/${FOREIGN}/git-credential`, { deviceId: MACHINE })).status,
    ).toBe(403);
    expect(asked).toEqual([]);
  });

  it("gives nothing for a repository the person can no longer read, and says the project lost it", async () => {
    // Still in the installation, still linked: the person was taken out of
    // the team that could open it.
    const { asked } = github({ people: { [tokenOf(USER)]: { 52: { push: true } } } });
    const response = await ask(PATH);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no_credential" });
    expect(minting(asked)).toEqual([]);
    expect((await link(PROJECT))?.lostAccessAt).toBeInstanceOf(Date);
    // The other project of the same account is untouched.
    expect((await ask(`/api/projects/${SECOND}/git-credential`)).status).toBe(200);
    expect((await link(SECOND))?.lostAccessAt).toBeNull();
    // Nor is a machine of the project given what its owner may not have.
    expect((await ask(PATH, { deviceId: MACHINE })).status).toBe(404);
    expect(minting(asked)).toHaveLength(1);
  });

  it("never gives a token that can write to a person who may only read", async () => {
    const { asked } = github({
      people: { [tokenOf(USER)]: { 51: { push: false }, 52: { push: true } } },
    });
    const response = await ask(PATH);
    expect(response.status).toBe(200);
    expect(minting(asked).map((request) => request.body)).toEqual([
      { repository_ids: [51], permissions: { contents: "read", metadata: "read" } },
    ]);
  });

  it("asks GitHub about the person once in ten minutes, not once per fetch", async () => {
    const { asked } = github();
    for (let i = 0; i < 3; i++) expect((await ask(PATH)).status).toBe(200);
    expect(asked.filter((request) => request.url.endsWith("/repositories/51"))).toHaveLength(1);
    expect(await env.OAUTH_KV.get(accessCacheKey(USER, 51), "json")).toEqual({
      pull: true,
      push: true,
    });
  });

  it("asks for less when the installation was not given pull requests", async () => {
    const { asked } = github({}, (request) => {
      if (!isTokenRequest(request)) return undefined;
      const { permissions } = request.body as { permissions: Record<string, string> };
      return permissions.pull_requests
        ? Response.json({ message: "The permissions requested are not granted" }, { status: 422 })
        : minted("ghs_without_pull_requests");
    });
    const response = await ask(PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ password: "ghs_without_pull_requests" });
    expect(minting(asked).map((request) => request.body)).toEqual([
      {
        repository_ids: [51],
        permissions: { contents: "write", metadata: "read", pull_requests: "write" },
      },
      { repository_ids: [51], permissions: { contents: "write", metadata: "read" } },
    ]);
  });

  it("gives up after that one retry, and on anything that is not about permissions", async () => {
    const refusing = github({}, (request) =>
      isTokenRequest(request) ? Response.json({}, { status: 422 }) : undefined,
    );
    const twice = await ask(PATH);
    expect(twice.status).toBe(502);
    expect(await twice.json()).toMatchObject({ error: "github_unavailable" });
    expect(minting(refusing.asked)).toHaveLength(2);

    restore?.();
    const suspended = github({}, (request) =>
      isTokenRequest(request) ? Response.json({}, { status: 403 }) : undefined,
    );
    expect((await ask(PATH)).status).toBe(502);
    expect(minting(suspended.asked)).toHaveLength(1);
    // Neither was a verdict on the person: the link stands.
    expect((await link(PROJECT))?.lostAccessAt).toBeNull();
  });

  it("does not take GitHub being busy for the person having lost access", async () => {
    github({}, (request) =>
      request.url.endsWith("/repositories/51")
        ? Response.json(
            { message: "API rate limit exceeded" },
            { status: 403, headers: { "x-ratelimit-remaining": "0" } },
          )
        : undefined,
    );
    const response = await ask(PATH);
    expect(response.status).toBe(502);
    expect((await link(PROJECT))?.lostAccessAt).toBeNull();
  });

  it("asks the account to connect again once its authorization is gone", async () => {
    const { asked } = github({ people: {} });
    const response = await ask(PATH);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "github_reconnect",
      message:
        "GitHub no longer accepts this account's authorization. Connect GitHub again from the settings.",
    });
    expect(minting(asked)).toEqual([]);
    expect(await hasUserToken(env, USER)).toBe(false);
    // Not the project's fault, and not written down as if it were.
    expect((await link(PROJECT))?.lostAccessAt).toBeNull();
    expect((await ask(PATH, { deviceId: MACHINE })).status).toBe(409);
  });

  it("has nothing for a project that is not connected, or no longer", async () => {
    const { asked } = github();
    const database = db(env);
    await database
      .update(schema.githubRepositories)
      .set({ lostAccessAt: new Date() })
      .where(eq(schema.githubRepositories.projectId, PROJECT))
      .run();
    const lost = await ask(PATH);
    expect(lost.status).toBe(404);
    expect(await lost.json()).toEqual({ error: "no_credential" });

    await database
      .update(schema.githubInstallations)
      .set({ suspendedAt: new Date() })
      .where(eq(schema.githubInstallations.id, "ghi_cred"))
      .run();
    const suspended = await ask(`/api/projects/${SECOND}/git-credential`);
    expect(suspended.status).toBe(404);

    await database
      .delete(schema.githubRepositories)
      .where(eq(schema.githubRepositories.projectId, SECOND))
      .run();
    expect((await ask(`/api/projects/${SECOND}/git-credential`)).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("checks the machine a CLI names", async () => {
    github();
    expect((await ask(PATH, { body: { deviceId: "dev_cred_laptop" } })).status).toBe(200);
    expect((await ask(PATH, { body: {} })).status).toBe(200);

    const revoked = await ask(PATH, { body: { deviceId: "dev_cred_revoked" } });
    expect(revoked.status).toBe(409);
    expect(await revoked.json()).toEqual({ error: "device_revoked" });
    const foreign = await ask(PATH, { body: { deviceId: "dev_cred_foreign" } });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "unknown_device" });
    const cloud = await ask(PATH, { body: { deviceId: MACHINE } });
    expect(cloud.status).toBe(400);
    expect(await cloud.json()).toEqual({ error: "cloud_device" });
    expect((await ask(PATH, { body: { deviceId: 7 } })).status).toBe(400);
  });

  it("never gives a token to the dashboard", async () => {
    const { asked } = github();
    const response = await ask(PATH, { scopes: DASHBOARD });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_scope" });
    expect(asked).toEqual([]);
  });
});

describe("whose credentials a clone tries first", () => {
  it("is the connection where the project has one that works", async () => {
    const on = await envOn();
    expect(await cloneCredential(on, PROJECT)).toBe("exeora");
    expect(await cloneCredential(on, "prj_that_does_not_exist")).toBe("machine");
    // The project is connected, the gateway is not.
    expect(await cloneCredential(envOff(), PROJECT)).toBe("machine");

    await db(env)
      .update(schema.githubRepositories)
      .set({ lostAccessAt: new Date() })
      .where(eq(schema.githubRepositories.projectId, PROJECT))
      .run();
    expect(await cloneCredential(on, PROJECT)).toBe("machine");
  });
});

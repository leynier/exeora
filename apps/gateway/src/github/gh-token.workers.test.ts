import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import {
  type Asked,
  authorize,
  CLI,
  CLOUD_CREDENTIALS_KEY,
  call,
  DASHBOARD,
  envOff,
  envOn,
  fakeGitHub,
  type TestEnv,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { hasUserToken } from "./user-token.js";

/**
 * The token `gh` in an instance acts with. It is the person's own, so most
 * of these are about who is refused, and the rest about which token it is.
 */

const USER = "usr_github_ghtoken";
const OTHER = "usr_github_ghtoken_other";
const INSTALLATION = 9201;
/** Connected through the app. */
const PROJECT = "prj_ght_api";
/** Never connected: a token somebody pasted, for a repository on github.com. */
const PASTED = "prj_ght_pasted";
/** The same, on a host that is not GitHub. */
const ELSEWHERE = "prj_ght_elsewhere";
/** On Exeora Cloud with a public repository: nothing connected, nothing kept. */
const BARE = "prj_ght_bare";
const FOREIGN = "prj_ght_foreign";
const MACHINES: Record<string, string> = {
  [PROJECT]: "dev_ght_machine_api",
  [PASTED]: "dev_ght_machine_pasted",
  [ELSEWHERE]: "dev_ght_machine_elsewhere",
  [BARE]: "dev_ght_machine_bare",
};
const LAPTOP = "dev_ght_laptop";
const HOUR = 60 * 60;

let restore: (() => void) | undefined;

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-ghtoken@example.com" },
      { id: OTHER, email: "github-ghtoken-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_ght_foreign", userId: OTHER, name: "laptop", platform: "linux" },
      ...Object.values(MACHINES).map((id) => ({
        id,
        userId: USER,
        name: `${id} (main)`,
        platform: "linux",
        kind: "cloud" as const,
      })),
    ])
    .run();
  const project = (id: string, userId: string, deviceId: string, url: string) => ({
    id,
    userId,
    deviceId,
    name: id,
    slug: id.replaceAll("_", "-"),
    localPath: `/w/${id}`,
    repoUrl: url,
    repoKey: url.replace(/^https:\/\//, "").replace(/\.git$/, ""),
  });
  const urls: Record<string, string> = {
    [PROJECT]: "https://github.com/acme/api.git",
    [PASTED]: "https://github.com/acme/pasted.git",
    [ELSEWHERE]: "https://gitlab.com/acme/elsewhere.git",
    [BARE]: "https://github.com/acme/bare.git",
  };
  await database
    .insert(schema.projects)
    .values([
      ...Object.entries(urls).map(([id, url]) => project(id, USER, LAPTOP, url)),
      project(FOREIGN, OTHER, "dev_ght_foreign", "https://github.com/globex/secret.git"),
    ])
    .run();
  const sealed = (token: string) => encryptSecret(CLOUD_CREDENTIALS_KEY, token);
  await database
    .insert(schema.cloudProjects)
    .values([
      { projectId: PROJECT, userId: USER, repoUrl: urls[PROJECT] ?? "", defaultBranch: "main" },
      {
        projectId: PASTED,
        userId: USER,
        repoUrl: urls[PASTED] ?? "",
        defaultBranch: "main",
        credentialUsername: "x-access-token",
        credentialCiphertext: await sealed("ghp_pasted_by_somebody"),
      },
      {
        projectId: ELSEWHERE,
        userId: USER,
        repoUrl: urls[ELSEWHERE] ?? "",
        defaultBranch: "main",
        credentialUsername: "oauth2",
        credentialCiphertext: await sealed("glpat_for_another_host"),
      },
      { projectId: BARE, userId: USER, repoUrl: urls[BARE] ?? "", defaultBranch: "main" },
    ])
    .run();
  await database
    .insert(schema.cloudMachines)
    .values(
      Object.entries(MACHINES).map(([projectId, deviceId]) => ({
        deviceId,
        userId: USER,
        projectId,
        spriteName: `exeora-${deviceId}`,
      })),
    )
    .run();
  await database
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_ght",
      userId: USER,
      installationId: INSTALLATION,
      accountLogin: "acme",
      accountType: "Organization",
    })
    .run();
  await database
    .insert(schema.githubRepositories)
    .values({
      projectId: PROJECT,
      userId: USER,
      installationId: INSTALLATION,
      repoId: 71,
      fullName: "acme/api",
      private: true,
    })
    .run();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

/** A GitHub that renews for `expected`, and refuses every other refresh token. */
function github(expected = "ghr_first", granted: Record<string, unknown> = {}) {
  const fake = fakeGitHub((asked: Asked) => {
    if (asked.url !== "https://github.com/login/oauth/access_token") return undefined;
    const body = asked.body as { refresh_token?: string };
    return Response.json(
      body.refresh_token === expected ? granted : { error: "bad_refresh_token" },
    );
  });
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const path = (projectId: string) => `/api/projects/${projectId}/gh-token`;

/** As the machine that was made for the project, unless said otherwise. */
const ask = async (
  projectId: string,
  options: { deviceId?: string | null; scopes?: string[]; userId?: string; env?: TestEnv } = {},
) => {
  const deviceId = options.deviceId === undefined ? MACHINES[projectId] : options.deviceId;
  return call(path(projectId), {
    method: "POST",
    userId: options.userId ?? USER,
    scopes: options.scopes ?? CLI,
    ...(deviceId ? { deviceId } : {}),
    env: options.env ?? (await envOn()),
  });
};

describe("POST /api/projects/:id/gh-token", () => {
  it("answers the machine of a connected project with the person's own token", async () => {
    const { asked } = github();
    const now = Date.now();
    await authorize(USER, {
      accessToken: "ghu_the_person",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      login: "mona",
      now,
    });
    const response = await ask(PROJECT);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      host: "github.com",
      token: "ghu_the_person",
      expiresAt: now + 8 * HOUR * 1000,
      login: "mona",
      source: "user",
    });
    // Good for hours yet: GitHub is asked nothing.
    expect(asked).toEqual([]);
  });

  it("says no end for a token GitHub gave none", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_for_good" });
    const response = await ask(PROJECT);
    expect(await response.json()).toEqual({
      host: "github.com",
      token: "ghu_for_good",
      expiresAt: null,
      login: "octocat",
      source: "user",
    });
  });

  it("renews a token that ran out, and answers with the new one", async () => {
    const { asked } = github("ghr_first", {
      access_token: "ghu_second",
      expires_in: 8 * HOUR,
      refresh_token: "ghr_second",
    });
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      login: "mona",
      now: Date.now() - 9 * HOUR * 1000,
    });
    const before = Date.now();
    const response = await ask(PROJECT);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { expiresAt: number };
    expect(body).toMatchObject({ token: "ghu_second", login: "mona", source: "user" });
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 8 * HOUR * 1000);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 8 * HOUR * 1000);
    expect(asked.map((request) => request.url)).toEqual([
      "https://github.com/login/oauth/access_token",
    ]);
    // Kept, so the next one to ask is answered without renewing again.
    expect(await (await ask(PROJECT)).json()).toMatchObject({ token: "ghu_second" });
    expect(asked).toHaveLength(1);
  });

  it("asks the person to connect again when the token cannot be renewed", async () => {
    github("ghr_that_github_knows");
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_spent",
      now: Date.now() - 9 * HOUR * 1000,
    });
    const response = await ask(PROJECT);
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "github_reconnect" });
    expect(body).not.toContain("ghu_first");
    expect(await hasUserToken(env, USER)).toBe(false);

    // And from then on, without asking GitHub: there is no token to renew.
    expect((await ask(PROJECT)).status).toBe(409);
  });

  it("says so when GitHub could not be asked to renew it", async () => {
    restore = replaceOutbound(fakeGitHub(() => Response.json({}, { status: 503 })).fetcher);
    await authorize(USER, {
      accessToken: "ghu_first",
      expiresIn: 8 * HOUR,
      refreshToken: "ghr_first",
      now: Date.now() - 9 * HOUR * 1000,
    });
    const response = await ask(PROJECT);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "github_unavailable" });
    // Not a verdict: the token is there for when GitHub answers.
    expect(await hasUserToken(env, USER)).toBe(true);
  });

  it("answers with the token that was pasted, for a repository on github.com", async () => {
    const { asked } = github();
    // Connected or not makes no difference to a project that is not.
    await authorize(USER, { accessToken: "ghu_the_person" });
    const response = await ask(PASTED);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      host: "github.com",
      token: "ghp_pasted_by_somebody",
      expiresAt: null,
      login: null,
      source: "stored",
    });
    expect(asked).toEqual([]);
  });

  it("answers with it as well once the project lost the connection it had", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    await db(env)
      .update(schema.githubRepositories)
      .set({ lostAccessAt: new Date() })
      .where(eq(schema.githubRepositories.projectId, PROJECT))
      .run();
    const nothing = await ask(PROJECT);
    expect(nothing.status).toBe(404);
    expect(await nothing.json()).toEqual({ error: "no_credential" });

    await db(env)
      .update(schema.cloudProjects)
      .set({ credentialCiphertext: await encryptSecret(CLOUD_CREDENTIALS_KEY, "ghp_kept") })
      .where(eq(schema.cloudProjects.projectId, PROJECT))
      .run();
    expect(await (await ask(PROJECT)).json()).toMatchObject({
      token: "ghp_kept",
      source: "stored",
    });
  });

  it("never shows GitHub's tool a token that was made for another host", async () => {
    github();
    const response = await ask(ELSEWHERE);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "not_github" });
    expect(body).not.toContain("glpat");
  });

  it("has nothing for a project with no connection and no token", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    const response = await ask(BARE);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "no_credential" });

    // Nor for one whose token was kept under a key this gateway no longer has.
    const rotated = await envOn({ CLOUD_CREDENTIALS_KEY: "f".repeat(64) });
    const unreadable = await ask(PASTED, { env: rotated });
    expect(unreadable.status).toBe(404);
    expect(await unreadable.json()).toEqual({ error: "no_credential" });
  });

  it("refuses the machine of another project, and what is no machine", async () => {
    const { asked } = github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    // The same account's machine, made for another of its projects.
    for (const projectId of [PROJECT, PASTED]) {
      const another = await ask(projectId, { deviceId: MACHINES[BARE] ?? "" });
      expect(another.status).toBe(403);
      expect(await another.text()).toBe(JSON.stringify({ error: "forbidden" }));
    }
    // A device of the account that is not a machine of Exeora Cloud.
    expect((await ask(PROJECT, { deviceId: LAPTOP })).status).toBe(403);
    // A machine does not reach across accounts, in either direction.
    expect((await ask(FOREIGN, { deviceId: MACHINES[PROJECT] ?? "" })).status).toBe(403);
    expect((await ask(PROJECT, { userId: OTHER, deviceId: MACHINES[PROJECT] ?? "" })).status).toBe(
      403,
    );
    expect(asked).toEqual([]);
  });

  it("refuses the person's own CLI", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    for (const projectId of [PROJECT, PASTED]) {
      const response = await ask(projectId, { deviceId: null, scopes: CLI });
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({ error: "insufficient_scope" });
      expect(body).not.toMatch(/ghu_|ghp_/);
    }
  });

  it("refuses the dashboard, which has every other route", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    for (const scopes of [DASHBOARD, [...DASHBOARD, ...CLI]]) {
      for (const projectId of [PROJECT, PASTED]) {
        const response = await ask(projectId, { deviceId: null, scopes });
        expect(response.status).toBe(403);
        const body = await response.text();
        expect(JSON.parse(body)).toEqual({ error: "forbidden" });
        expect(body).not.toMatch(/ghu_|ghp_/);
      }
    }
  });

  it("refuses a machine whose token was not given the scope", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    const response = await ask(PROJECT, { scopes: ["executor:execute"] });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_scope" });
  });

  it("is answered to a POST and nothing else", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    const response = await call(path(PROJECT), {
      method: "GET",
      userId: USER,
      scopes: CLI,
      deviceId: MACHINES[PROJECT] ?? "",
      env: await envOn(),
    });
    expect(response.status).toBe(403);
  });

  it("says the connection is off on a gateway without the app, and still gives what was pasted", async () => {
    github();
    await authorize(USER, { accessToken: "ghu_the_person" });
    const off = envOff();
    // Connected once, on a gateway that no longer has the app to speak with.
    const connected = await ask(PROJECT, { env: off });
    expect(connected.status).toBe(404);
    expect(await connected.json()).toEqual({ error: "github_disabled" });
    expect(await (await ask(BARE, { env: off })).json()).toEqual({ error: "github_disabled" });

    // A token that was pasted needs no app to be answered with.
    const pasted = await ask(PASTED, { env: off });
    expect(pasted.status).toBe(200);
    expect(await pasted.json()).toMatchObject({
      token: "ghp_pasted_by_somebody",
      source: "stored",
    });
    expect(await (await ask(ELSEWHERE, { env: off })).json()).toEqual({ error: "not_github" });
  });
});

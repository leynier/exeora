import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { accessCacheKey } from "./access.js";
import {
  authorize,
  envOff,
  envOn,
  githubWorld,
  repository,
  signature,
  type TestEnv,
  tokenOf,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { repositoriesCacheKey } from "./repositories.js";
import { verifySignature } from "./webhook.js";

/**
 * Deliveries from GitHub, sent through the Worker's own entry point: the
 * webhook has no access token, so that it is answered at all is part of what
 * is tested here.
 */

const USER = "usr_github_hook";
const OTHER = "usr_github_hook_other";
const INSTALLATION = 7101;

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    await env.OAUTH_KV.delete(accessCacheKey(id, 32));
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-hook@example.com" },
      { id: OTHER, email: "github-hook-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.githubInstallations)
    .values([
      {
        id: "ghi_hook_mine",
        userId: USER,
        installationId: INSTALLATION,
        accountLogin: "acme",
        accountType: "Organization",
      },
      {
        id: "ghi_hook_theirs",
        userId: OTHER,
        installationId: INSTALLATION,
        accountLogin: "acme",
        accountType: "Organization",
      },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: "dev_hook", userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_hook_other", userId: OTHER, name: "laptop", platform: "linux" },
    ])
    .run();
  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_hook_api",
        userId: USER,
        deviceId: "dev_hook",
        name: "api",
        slug: "api",
        localPath: "/w/api",
        repoUrl: "https://github.com/acme/api.git",
        repoKey: "github.com/acme/api",
      },
      {
        id: "prj_hook_web",
        userId: USER,
        deviceId: "dev_hook",
        name: "web",
        slug: "web",
        localPath: "/w/web",
        repoUrl: "https://github.com/acme/web.git",
        repoKey: "github.com/acme/web",
      },
      {
        id: "prj_hook_theirs",
        userId: OTHER,
        deviceId: "dev_hook_other",
        name: "web",
        slug: "web",
        localPath: "/w/web",
        repoUrl: "https://github.com/acme/web.git",
        repoKey: "github.com/acme/web",
      },
    ])
    .run();
  await database
    .insert(schema.githubRepositories)
    .values({
      projectId: "prj_hook_api",
      userId: USER,
      installationId: INSTALLATION,
      repoId: 31,
      fullName: "acme/api",
    })
    .run();
});

async function deliver(
  event: string,
  payload: unknown,
  options: { sign?: string | null; env?: TestEnv } = {},
) {
  const body = JSON.stringify(payload);
  const signed = options.sign === undefined ? await signature(body) : options.sign;
  return worker.fetch(
    new Request("https://exeora.dev/api/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-GitHub-Event": event,
        ...(signed === null ? {} : { "X-Hub-Signature-256": signed }),
      },
      body,
    }),
    (options.env ?? (await envOn())) as unknown as Env,
    createExecutionContext(),
  );
}

const link = (projectId: string) =>
  db(env)
    .select()
    .from(schema.githubRepositories)
    .where(eq(schema.githubRepositories.projectId, projectId))
    .get();

const project = (projectId: string) =>
  db(env).select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();

const removed = {
  action: "removed",
  installation: { id: INSTALLATION },
  repository_selection: "selected",
  repositories_removed: [{ id: 31, full_name: "acme/api", private: true }],
  repositories_added: [],
};

describe("the webhook's signature", () => {
  it("refuses a delivery that is unsigned, or signed by somebody else", async () => {
    const unsigned = await deliver("installation_repositories", removed, { sign: null });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "invalid_signature" });

    const forged = await deliver("installation_repositories", removed, {
      sign: await signature(JSON.stringify(removed), "a-secret-that-is-not-the-app's"),
    });
    expect(forged.status).toBe(401);

    // Signed, but for another body: what was signed is not what arrived.
    const swapped = await deliver("installation_repositories", removed, {
      sign: await signature(JSON.stringify({ ...removed, action: "added" })),
    });
    expect(swapped.status).toBe(401);
    expect(
      (await deliver("installation_repositories", removed, { sign: "sha256=zz" })).status,
    ).toBe(401);

    expect((await link("prj_hook_api"))?.lostAccessAt).toBeNull();
  });

  it("is compared as bytes, in the form GitHub sends it", async () => {
    const body = new TextEncoder().encode("{}").buffer as ArrayBuffer;
    const good = await signature("{}", "s3cret");
    expect(await verifySignature("s3cret", body, good)).toBe(true);
    expect(
      await verifySignature("s3cret", body, good.toUpperCase().replace("SHA256", "sha256")),
    ).toBe(true);
    expect(await verifySignature("s3cret", body, good.replace("sha256=", "sha1="))).toBe(false);
    expect(await verifySignature("s3cret", body, undefined)).toBe(false);
    // An empty secret signs nothing: it is refused before anything is compared.
    expect(await verifySignature("", body, good)).toBe(false);
  });

  it("answers that the connection is off on a gateway without the app", async () => {
    const response = await deliver("installation_repositories", removed, { env: envOff() });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "github_disabled" });
  });

  it("is the only thing under the API that is reached without a token", async () => {
    const response = await worker.fetch(
      new Request("https://exeora.dev/api/github"),
      (await envOn()) as unknown as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(401);
    const get = await worker.fetch(
      new Request("https://exeora.dev/api/github/webhook"),
      (await envOn()) as unknown as Env,
      createExecutionContext(),
    );
    expect(get.status).toBe(401);
  });
});

describe("what a delivery changes", () => {
  it("marks a repository that left the installation", async () => {
    for (const id of [USER, OTHER]) {
      await env.OAUTH_KV.put(repositoriesCacheKey(id, INSTALLATION), "[]");
    }
    const response = await deliver("installation_repositories", removed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect((await link("prj_hook_api"))?.lostAccessAt).toBeInstanceOf(Date);
    // The picker's list is asked for again, by everyone who holds the installation.
    for (const id of [USER, OTHER]) {
      expect(await env.OAUTH_KV.get(repositoriesCacheKey(id, INSTALLATION))).toBeNull();
    }
  });

  it("leaves the same repository alone in another installation", async () => {
    await deliver("installation_repositories", {
      ...removed,
      installation: { id: INSTALLATION + 1 },
    });
    expect((await link("prj_hook_api"))?.lostAccessAt).toBeNull();
  });

  const added = {
    action: "added",
    installation: { id: INSTALLATION },
    repository_selection: "all",
    repositories_added: [{ id: 32, full_name: "acme/web", private: true }],
    repositories_removed: [],
  };
  const held = { [INSTALLATION]: [repository(32, "acme/web", { private: true })] };

  it("connects the projects of those who hold the installation and can read what was added", async () => {
    await authorize(USER);
    await authorize(OTHER);
    // Both hold the installation and both have a project that is this
    // repository. The organisation lets one of them read it.
    const { fetcher, asked } = githubWorld({
      installations: held,
      people: { [tokenOf(USER)]: { 32: { push: true } }, [tokenOf(OTHER)]: {} },
    });
    restore = replaceOutbound(fetcher);
    const response = await deliver("installation_repositories", added);
    expect(response.status).toBe(200);

    expect(await link("prj_hook_web")).toMatchObject({
      userId: USER,
      installationId: INSTALLATION,
      repoId: 32,
      fullName: "acme/web",
      private: true,
      lostAccessAt: null,
    });
    expect(await link("prj_hook_theirs")).toBeUndefined();
    // Each was asked about as themselves.
    expect(asked.map((request) => request.headers.get("Authorization")).sort()).toEqual(
      [`Bearer ${tokenOf(OTHER)}`, `Bearer ${tokenOf(USER)}`].sort(),
    );
    const installations = await db(env)
      .select({ selection: schema.githubInstallations.repositorySelection })
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.installationId, INSTALLATION))
      .all();
    expect(installations).toEqual([{ selection: "all" }, { selection: "all" }]);
  });

  it("links nothing for a holder who has to connect again, and still serves the others", async () => {
    // Only one of the two ever stored a token.
    await authorize(OTHER);
    const { fetcher } = githubWorld({
      installations: held,
      people: { [tokenOf(OTHER)]: { 32: { push: false } } },
    });
    restore = replaceOutbound(fetcher);
    const response = await deliver("installation_repositories", added);
    expect(response.status).toBe(200);
    expect(await link("prj_hook_web")).toBeUndefined();
    expect(await link("prj_hook_theirs")).toMatchObject({ userId: OTHER, repoId: 32 });
  });

  it("follows a repository to its new name", async () => {
    const response = await deliver("repository", {
      action: "renamed",
      installation: { id: INSTALLATION },
      repository: { id: 31, full_name: "acme/Platform-API", private: true },
    });
    expect(response.status).toBe(200);

    expect(await project("prj_hook_api")).toMatchObject({
      repoUrl: "https://github.com/acme/Platform-API.git",
      repoKey: "github.com/acme/platform-api",
    });
    expect(await link("prj_hook_api")).toMatchObject({
      fullName: "acme/Platform-API",
      private: true,
      lostAccessAt: null,
    });
    // A project that is another repository keeps its own address.
    expect(await project("prj_hook_web")).toMatchObject({
      repoUrl: "https://github.com/acme/web.git",
    });
  });

  it("follows a repository to its new owner", async () => {
    await deliver("repository", {
      action: "transferred",
      installation: { id: INSTALLATION },
      repository: { id: 31, full_name: "globex/api", private: false },
    });
    expect(await project("prj_hook_api")).toMatchObject({
      repoUrl: "https://github.com/globex/api.git",
      repoKey: "github.com/globex/api",
    });
  });

  it("refuses a name that is not a repository's", async () => {
    const response = await deliver("repository", {
      action: "renamed",
      installation: { id: INSTALLATION },
      repository: { id: 31, full_name: "acme/api/../../evil", private: false },
    });
    expect(response.status).toBe(204);
    expect(await project("prj_hook_api")).toMatchObject({ repoKey: "github.com/acme/api" });
  });

  it("marks a repository that was deleted", async () => {
    await deliver("repository", {
      action: "deleted",
      installation: { id: INSTALLATION },
      repository: { id: 31, full_name: "acme/api", private: false },
    });
    expect((await link("prj_hook_api"))?.lostAccessAt).toBeInstanceOf(Date);
  });

  it("suspends and resumes an installation for everyone who holds it", async () => {
    const suspended = () =>
      db(env)
        .select({ at: schema.githubInstallations.suspendedAt })
        .from(schema.githubInstallations)
        .where(eq(schema.githubInstallations.installationId, INSTALLATION))
        .all();

    await deliver("installation", { action: "suspend", installation: { id: INSTALLATION } });
    expect((await suspended()).every((row) => row.at instanceof Date)).toBe(true);
    // Suspended is not lost: the link is there for when it resumes.
    expect((await link("prj_hook_api"))?.lostAccessAt).toBeNull();

    await deliver("installation", { action: "unsuspend", installation: { id: INSTALLATION } });
    expect(await suspended()).toEqual([{ at: null }, { at: null }]);
  });

  it("forgets an installation that was removed, and marks what cloned through it", async () => {
    const response = await deliver("installation", {
      action: "deleted",
      installation: { id: INSTALLATION },
    });
    expect(response.status).toBe(200);
    const left = await db(env)
      .select()
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.installationId, INSTALLATION))
      .all();
    expect(left).toEqual([]);
    expect((await link("prj_hook_api"))?.lostAccessAt).toBeInstanceOf(Date);
  });

  it("answers 204 to what it does not act on", async () => {
    expect((await deliver("ping", { zen: "Keep it logically awesome." })).status).toBe(204);
    expect((await deliver("push", { ref: "refs/heads/main" })).status).toBe(204);
    expect(
      (await deliver("installation", { action: "created", installation: { id: 1 } })).status,
    ).toBe(204);
    expect((await deliver("repository", { action: "renamed" })).status).toBe(204);
  });

  it("refuses a signed body that is not JSON", async () => {
    const body = "not json";
    const response = await worker.fetch(
      new Request("https://exeora.dev/api/github/webhook", {
        method: "POST",
        headers: { "X-GitHub-Event": "ping", "X-Hub-Signature-256": await signature(body) },
        body,
      }),
      (await envOn()) as unknown as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
  });
});

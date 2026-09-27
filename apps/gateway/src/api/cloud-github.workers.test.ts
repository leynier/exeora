import { env, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberAccountAuthorization } from "../account-access.js";
import { accountProjects } from "../client-targets.js";
import { db, schema } from "../db/client.js";
import { accessCacheKey } from "../github/access.js";
import {
  type Asked,
  authorize,
  call,
  envOff,
  envOn,
  fakeGitHub,
  githubWorld,
  isTokenRequest,
  repository,
  type TestEnv,
  tokenOf,
} from "../github/fixtures.js";
import { replaceOutbound } from "../github/outbound.js";

/**
 * Making a Cloud project out of a repository that was picked, and out of an
 * address whose branch nobody named: both ask another host before a machine
 * is made, so that what is wrong is said in the dialog.
 */

const USER = "usr_cloud_github";
const INSTALLATION = 6101;
const SOMEBODY_ELSES = 6999;

let restore: (() => void) | undefined;

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  for (const repo of [61, 62, 63]) await env.OAUTH_KV.delete(accessCacheKey(USER, repo));
  await database
    .insert(schema.users)
    .values({ id: USER, email: "cloud-github@example.com", cloudEnabled: true })
    .run();
  await authorize(USER);
  await database
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_cloud",
      userId: USER,
      installationId: INSTALLATION,
      accountLogin: "acme",
      accountType: "Organization",
    })
    .run();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

const SHA = "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d";
const pkt = (line: string) => `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
const advertised = (branch: string) =>
  new Response(
    [
      pkt("# service=git-upload-pack\n"),
      "0000",
      pkt(`${SHA} HEAD\0multi_ack symref=HEAD:refs/heads/${branch} agent=git/2\n`),
      pkt(`${SHA} refs/heads/${branch}\n`),
      "0000",
    ].join(""),
    { headers: { "content-type": "application/x-git-upload-pack-advertisement" } },
  );

function outside(handler: (asked: Asked) => Response | undefined) {
  const fake = fakeGitHub(handler);
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

/**
 * The account's installation holds two repositories, and the person can
 * open the first. A third is theirs to open and is in no installation.
 */
function github(people = { [tokenOf(USER)]: { 61: { push: true }, 62: { push: true } } }) {
  const fake = githubWorld({
    installations: {
      [INSTALLATION]: [
        repository(61, "acme/Platform.API", { private: true, default_branch: "develop" }),
        repository(63, "acme/payroll", { private: true }),
      ],
      [SOMEBODY_ELSES]: [repository(62, "globex/elsewhere")],
    },
    people,
  });
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const create = (body: unknown, testEnv: TestEnv) =>
  call("/api/cloud/projects", { body, userId: USER, env: testEnv });

const provisioned = (deviceId: string) =>
  runInDurableObject(env.CLOUD_MACHINE.getByName(deviceId), async (_instance, state) => ({
    input: await state.storage.get<{
      repoUrl: string;
      branch: string;
      credentialHelper?: { projectId: string };
    }>("input"),
    secrets: await state.storage.get<{ machineToken: string; credential?: unknown }>("secrets"),
  }));

describe("a Cloud project from a picked repository", () => {
  it("takes the address, the branch and the name from GitHub, and clones through the connection", async () => {
    const { asked } = github();
    const response = await create(
      { github: { repositoryId: 61, installationId: INSTALLATION }, token: "ghp_ignored" },
      await envOn(),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { projectId: string; deviceId: string };
    expect(body).toMatchObject({ status: "creating", location: "created" });

    // Asked as the person whether they can read it, then as the
    // installation, for that repository and to read its name.
    expect(asked[0]?.url).toBe("https://api.github.com/repositories/61");
    expect(asked[0]?.headers.get("Authorization")).toBe(`Bearer ${tokenOf(USER)}`);
    expect(asked[1]?.body).toEqual({ repository_ids: [61], permissions: { metadata: "read" } });

    const database = db(env);
    expect(
      await database
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, body.projectId))
        .get(),
    ).toMatchObject({
      name: "Platform.API",
      slug: "platform-api",
      repoUrl: "https://github.com/acme/Platform.API.git",
      repoKey: "github.com/acme/platform.api",
      defaultBranch: "develop",
    });
    expect(
      await database
        .select()
        .from(schema.cloudProjects)
        .where(eq(schema.cloudProjects.projectId, body.projectId))
        .get(),
    ).toMatchObject({ defaultBranch: "develop", credentialCiphertext: null });
    expect(
      await database
        .select()
        .from(schema.githubRepositories)
        .where(eq(schema.githubRepositories.projectId, body.projectId))
        .get(),
    ).toMatchObject({
      userId: USER,
      installationId: INSTALLATION,
      repoId: 61,
      fullName: "acme/Platform.API",
      private: true,
      lostAccessAt: null,
    });

    // The machine is told to ask for its credential, and is given none.
    const machine = await provisioned(body.deviceId);
    expect(machine.input).toMatchObject({
      repoUrl: "https://github.com/acme/Platform.API.git",
      branch: "develop",
      credentialHelper: { projectId: body.projectId },
    });
    expect(machine.secrets?.credential).toBeUndefined();

    const listed = (await (
      await call("/api/projects", { userId: USER, env: await envOn() })
    ).json()) as Array<{ id: string; github: unknown }>;
    expect(listed.find((entry) => entry.id === body.projectId)?.github).toEqual({
      fullName: "acme/Platform.API",
      private: true,
      lostAccess: false,
    });
  });

  it("lets the caller name the project and the branch", async () => {
    github();
    const response = await create(
      {
        github: { repositoryId: 61, installationId: INSTALLATION },
        name: "Platform",
        slug: "platform",
        defaultBranch: "release",
      },
      await envOn(),
    );
    const body = (await response.json()) as { projectId: string };
    expect(
      await db(env)
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, body.projectId))
        .get(),
    ).toMatchObject({ name: "Platform", slug: "platform", defaultBranch: "release" });
  });

  it("refuses a repository the person cannot open, though the installation holds it", async () => {
    const { asked } = github();
    const response = await create(
      { github: { repositoryId: 63, installationId: INSTALLATION } },
      await envOn(),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "github_not_connected" });
    // Found out as the person, and no token was minted to find it out.
    expect(asked.map((request) => request.url)).toEqual(["https://api.github.com/repositories/63"]);
    expect(await db(env).select().from(schema.githubRepositories).all()).toEqual([]);
    expect(
      await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all(),
    ).toEqual([]);
  });

  it("refuses an installation that is not the account's, and a repository that is not in it", async () => {
    const { asked } = github();
    const foreign = await create(
      { github: { repositoryId: 62, installationId: SOMEBODY_ELSES } },
      await envOn(),
    );
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toMatchObject({ error: "github_not_connected" });
    // Refused from the database: nothing was asked in that installation's name.
    expect(asked).toEqual([]);

    // The person can open it. The installation named does not hold it.
    const outsideIt = await create(
      { github: { repositoryId: 62, installationId: INSTALLATION } },
      await envOn(),
    );
    expect(outsideIt.status).toBe(422);
    expect(await outsideIt.json()).toMatchObject({ error: "github_unavailable" });
    expect(asked.filter((request) => isTokenRequest(request))).toHaveLength(1);

    const off = await create(
      { github: { repositoryId: 61, installationId: INSTALLATION } },
      envOff(),
    );
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ error: "github_disabled" });

    const nothing = await create({ name: "only a name" }, await envOn());
    expect(nothing.status).toBe(400);
    expect(
      await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all(),
    ).toEqual([]);
  });

  it("asks an account whose authorization is gone to connect again", async () => {
    github({});
    const response = await create(
      { github: { repositoryId: 61, installationId: INSTALLATION } },
      await envOn(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "github_reconnect" });
    expect(
      await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all(),
    ).toEqual([]);
  });

  it("connects a project the account already has, rather than making it again", async () => {
    github();
    const database = db(env);
    await database
      .insert(schema.devices)
      .values({ id: "dev_cloud_gh_laptop", userId: USER, name: "laptop", platform: "linux" })
      .run();
    await database
      .insert(schema.projects)
      .values({
        id: "prj_cloud_gh_existing",
        userId: USER,
        deviceId: "dev_cloud_gh_laptop",
        name: "platform",
        slug: "platform",
        localPath: "/w/platform",
        repoUrl: "https://github.com/acme/Platform.API.git",
        repoKey: "github.com/acme/platform.api",
      })
      .run();

    const response = await create(
      { github: { repositoryId: 61, installationId: INSTALLATION } },
      await envOn(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId: "prj_cloud_gh_existing",
      location: "joined",
    });
    expect(
      await database
        .select()
        .from(schema.githubRepositories)
        .where(eq(schema.githubRepositories.projectId, "prj_cloud_gh_existing"))
        .get(),
    ).toMatchObject({ repoId: 61, lostAccessAt: null });
    // The branch it never knew is the one GitHub says, not a guess.
    expect(
      await database
        .select()
        .from(schema.cloudProjects)
        .where(eq(schema.cloudProjects.projectId, "prj_cloud_gh_existing"))
        .get(),
    ).toMatchObject({ defaultBranch: "develop" });
  });

  it("gives a project that already existed to the clients named, as it does a new one", async () => {
    github();
    const database = db(env);
    await database
      .insert(schema.devices)
      .values({ id: "dev_cloud_gh_grant", userId: USER, name: "laptop", platform: "linux" })
      .run();
    const project = (id: string, name: string) => ({
      id,
      userId: USER,
      deviceId: "dev_cloud_gh_grant",
      name,
      slug: name,
      localPath: `/w/${name}`,
      repoUrl: `https://git.example.test/acme/${name}.git`,
      repoKey: `git.example.test/acme/${name}`,
    });
    await database
      .insert(schema.projects)
      .values([project("prj_cloud_gh_first", "first"), project("prj_cloud_gh_joined", "joined")])
      .run();
    // Two clients on the account URL, each given the first project only. A
    // third that nobody ever authorized.
    for (const clientId of ["client_named", "client_left_out"]) {
      await rememberAccountAuthorization(env, {
        userId: USER,
        clientId,
        projectIds: ["prj_cloud_gh_first"],
        allProjects: false,
        clientName: clientId,
        clientUri: undefined,
      });
    }
    const reached = async (clientId: string) =>
      (await accountProjects(env, { userId: USER, clientId })).map((entry) => entry.id).sort();

    const response = await create(
      {
        name: "joined again",
        slug: "joined-again",
        repoUrl: "https://git.example.test/acme/joined.git",
        defaultBranch: "main",
        clientIds: ["client_named", "client_nobody_authorized"],
      },
      await envOn(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId: "prj_cloud_gh_joined",
      location: "joined",
    });

    expect(await reached("client_named")).toEqual(["prj_cloud_gh_first", "prj_cloud_gh_joined"]);
    expect(await reached("client_left_out")).toEqual(["prj_cloud_gh_first"]);
    expect(await reached("client_nobody_authorized")).toEqual([]);
  });
});

describe("a Cloud project from an address", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    name: "widgets",
    slug: "widgets",
    repoUrl: "https://git.example.test/acme/widgets.git",
    ...extra,
  });

  it("asks the repository for its branch when nobody named one", async () => {
    const { asked } = outside((request) =>
      request.url.startsWith("https://git.example.test/") ? advertised("trunk") : undefined,
    );
    const response = await create(
      body({ token: "glpat_secret", username: "oauth2" }),
      await envOn(),
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as { projectId: string; deviceId: string };

    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(
      "https://git.example.test/acme/widgets.git/info/refs?service=git-upload-pack",
    );
    expect(asked[0]?.headers.get("Authorization")).toBe(`Basic ${btoa("oauth2:glpat_secret")}`);
    expect(
      await db(env)
        .select()
        .from(schema.cloudProjects)
        .where(eq(schema.cloudProjects.projectId, created.projectId))
        .get(),
    ).toMatchObject({ defaultBranch: "trunk", credentialUsername: "oauth2" });
    // Not connected to GitHub: the token travels as it always has.
    const machine = await provisioned(created.deviceId);
    expect(machine.input?.credentialHelper).toBeUndefined();
    expect(machine.secrets?.credential).toEqual({ username: "oauth2", secret: "glpat_secret" });
  });

  it("asks nothing when the branch was named", async () => {
    const { asked } = outside(() => undefined);
    const response = await create(body({ defaultBranch: "main" }), await envOn());
    expect(response.status).toBe(202);
    expect(asked).toEqual([]);
  });

  it("says in the dialog what a machine would have said a minute later", async () => {
    outside(() => new Response("", { status: 401 }));
    const refused = await create(body({ token: "wrong" }), await envOn());
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: "clone_auth_failed",
      message: "The repository refused access. Set a token that can read it, then retry.",
    });

    restore?.();
    outside(() => new Response("", { status: 404 }));
    const missing = await create(body(), await envOn());
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: "repo_not_found" });

    restore?.();
    outside(() => {
      throw new TypeError("no route to host");
    });
    const down = await create(body(), await envOn());
    expect(down.status).toBe(422);
    expect(await down.json()).toMatchObject({ error: "unreachable" });

    expect(
      await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all(),
    ).toEqual([]);
    expect(
      await db(env).select().from(schema.devices).where(eq(schema.devices.userId, USER)).all(),
    ).toEqual([]);
  });

  it("asks no host anything for an account that may not make machines", async () => {
    await db(env)
      .update(schema.users)
      .set({ cloudEnabled: false })
      .where(eq(schema.users.id, USER));
    const { asked } = outside(() => advertised("main"));
    const response = await create(body(), await envOn());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cloud_disabled" });
    expect(asked).toEqual([]);
  });
});

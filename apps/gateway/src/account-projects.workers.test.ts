import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accountProjects } from "./client-targets.js";
import { listWorkspacesWithCloud } from "./cloud/workspace-tools.js";
import { db, schema } from "./db/client.js";
import { registerProject } from "./project-register.js";

/**
 * What an agent on the account URL is told about where things are.
 *
 * It reads these two answers and nothing else before deciding where to work,
 * so they have to say which locations exist, which one a call lands on, and
 * where each workspace lives.
 */

const USER = "usr_account_projects";
const CLIENT = "client_agent";
const LAPTOP = "dev_ap_laptop";
const DESKTOP = "dev_ap_desktop";
const REPO = {
  repoUrl: "https://github.com/acme/api.git",
  repoKey: "github.com/acme/api",
  defaultBranch: "develop",
};

let PROJECT: string;

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "agent@example.com", plan: "pro" })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin", lastSeenAt: new Date() },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
    ])
    .run();

  for (const deviceId of [LAPTOP, DESKTOP]) {
    const made = await registerProject(
      env,
      USER,
      { deviceId, name: "api", slug: "api", localPath: "/home/me/code/api" },
      REPO,
    );
    if ("error" in made) throw new Error(made.error);
    PROJECT = made.id;
  }
  await database
    .insert(schema.projectClients)
    .values({
      id: "pcl_account_projects",
      userId: USER,
      projectId: PROJECT,
      clientId: CLIENT,
      endpoint: "account",
      authorizedAt: new Date(),
    })
    .run();
});

const reachable = () => accountProjects(env, { userId: USER, clientId: CLIENT });

describe("what list_projects says", () => {
  it("names the repository and every location, with the default marked", async () => {
    expect(await reachable()).toEqual([
      {
        id: PROJECT,
        slug: "api",
        name: "api",
        repository: "github.com/acme/api",
        machine: "Laptop",
        online: true,
        locations: [
          { name: "laptop", kind: "local", state: "online", default: true },
          { name: "desktop", kind: "local", state: "offline", default: false },
        ],
      },
    ]);
  });

  it("keeps listing a project that lost the machine of its default location", async () => {
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, LAPTOP))
      .run();

    expect(await reachable()).toMatchObject([
      {
        slug: "api",
        online: false,
        locations: [{ name: "desktop", default: false }],
      },
    ]);
  });

  it("stops listing a project once every machine it was on is gone", async () => {
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.userId, USER))
      .run();

    expect(await reachable()).toEqual([]);
  });
});

describe("what list_workspaces says", () => {
  it("lists the project root first, then each workspace with where it lives", async () => {
    await db(env)
      .insert(schema.workspaces)
      .values([
        {
          id: "wsp_ap_fix",
          projectId: PROJECT,
          slug: "fix-login",
          name: "fix/login",
          branch: "fix/login",
          localPath: "/worktrees/fix-login",
          managed: true,
          deviceId: DESKTOP,
        },
        {
          id: "wsp_ap_old",
          projectId: PROJECT,
          slug: "older",
          name: "older",
          branch: "older",
          localPath: "/worktrees/older",
          managed: true,
        },
      ])
      .run();

    expect(await listWorkspacesWithCloud(env, USER, PROJECT)).toEqual([
      {
        slug: "main",
        name: "project root",
        branch: "develop",
        managed: false,
        root: true,
        location: "laptop",
      },
      {
        slug: "fix-login",
        name: "fix/login",
        branch: "fix/login",
        managed: true,
        location: "desktop",
      },
      // From before workspaces carried their machine: it is on the default's.
      { slug: "older", name: "older", branch: "older", managed: true, location: "laptop" },
    ]);
  });

  it("says nothing of a project that is somebody else's", async () => {
    expect(await listWorkspacesWithCloud(env, "usr_stranger", PROJECT)).toEqual([]);
  });
});

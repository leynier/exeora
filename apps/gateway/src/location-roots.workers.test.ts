import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { call as request } from "./api/clients-fixtures.js";
import { listWorkspacesWithCloud } from "./cloud/workspace-tools.js";
import { db, schema } from "./db/client.js";
import { recorded, resolveWorkspace, routing, workspaceKey } from "./dispatch.js";
import { defaultRootSelector, rootLocation, rootSelector } from "./location-roots.js";
import { registerProject } from "./project-register.js";

/**
 * The project root of a location that is not the default.
 *
 * It is a place a call can land, on a machine of its own, and it is not a
 * workspace: the machine is told nothing about one, and the trail says where
 * the call ran.
 */

const USER = "usr_location_roots";
const LAPTOP = "dev_lr_laptop";
const DESKTOP = "dev_lr_desktop";
const SERVER = "dev_lr_server";
let PROJECT: string;

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "roots@example.com", plan: "pro" })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
      { id: SERVER, userId: USER, name: "Server", platform: "linux" },
    ])
    .run();
  for (const deviceId of [LAPTOP, DESKTOP]) {
    const made = await registerProject(
      env,
      USER,
      { deviceId, name: "api", slug: "api", localPath: "/home/me/code/api" },
      {
        repoUrl: "https://github.com/acme/api.git",
        repoKey: "github.com/acme/api",
        defaultBranch: "main",
      },
    );
    if ("error" in made) throw new Error(made.error);
    PROJECT = made.id;
  }
  // Chosen as a location, and holding no copy yet.
  await database
    .insert(schema.projectLocations)
    .values({
      id: "loc_lr_server",
      projectId: PROJECT,
      userId: USER,
      kind: "local",
      deviceId: SERVER,
      status: "pending",
    })
    .run();
});

describe("naming the root of a location", () => {
  it("reads a selector, and only a selector", () => {
    expect(rootLocation("main@desktop")).toBe("desktop");
    expect(rootLocation("MAIN@Desktop")).toBe("desktop");
    expect(rootLocation("main")).toBeNull();
    expect(rootLocation("fix-login")).toBeNull();
    expect(rootLocation("main@")).toBeNull();
    expect(rootLocation("main@a b")).toBeNull();
    expect(rootLocation(undefined)).toBeNull();
    expect(rootSelector("desktop")).toBe("main@desktop");
    expect(defaultRootSelector({ name: "My Laptop", kind: "local" })).toBe("main@my-laptop");
    expect(defaultRootSelector({ name: "api (main)", kind: "cloud" })).toBe("main@cloud");
  });

  it("goes to the machine that holds that copy, and names no workspace to it", async () => {
    const root = await resolveWorkspace(env, PROJECT, "main@desktop");

    expect(root).toEqual({ id: null, slug: "main@desktop", deviceId: DESKTOP });
    expect(routing(root)).toEqual({});
    expect(recorded(root, "main@laptop")).toEqual({ workspaceSlug: "main@desktop" });
    // An approval given for one place is not spent in another.
    expect(workspaceKey(root)).toBe("main@desktop");
    expect(workspaceKey(null)).toBeUndefined();
  });

  it("treats the default's root as main under another name", async () => {
    expect(await resolveWorkspace(env, PROJECT, "main@laptop")).toBeNull();
    expect(recorded(null, "main@laptop")).toEqual({ workspaceSlug: "main@laptop" });
  });

  it("refuses a location that is not the project's, in words", async () => {
    await expect(resolveWorkspace(env, PROJECT, "main@nowhere")).rejects.toMatchObject({
      code: "UNKNOWN_WORKSPACE",
      message: expect.stringContaining("laptop, desktop, server"),
    });
  });

  it("refuses a machine that has no copy yet, and says how it gets one", async () => {
    await expect(resolveWorkspace(env, PROJECT, "main@server")).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
      message: expect.stringContaining("create_workspace"),
    });
  });

  it("refuses a machine that was removed", async () => {
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, DESKTOP))
      .run();

    await expect(resolveWorkspace(env, PROJECT, "main@desktop")).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
    });
  });
});

describe("what is listed and what the dashboard can open", () => {
  it("lists a root for every location that holds a copy", async () => {
    const listed = await listWorkspacesWithCloud(env, USER, PROJECT);

    expect(listed.map((entry) => [entry.slug, entry.location])).toEqual([
      ["main", "laptop"],
      ["main@desktop", "desktop"],
    ]);
  });

  it("answers the dashboard for the root of another location", async () => {
    // Nobody is connected, which is the answer of the right machine: a
    // selector that was not understood would be a 404.
    const response = await request(
      `/api/projects/${PROJECT}/workspace/status?workspace=${encodeURIComponent("main@desktop")}`,
      { userId: USER },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });

    const unknown = await request(
      `/api/projects/${PROJECT}/workspace/status?workspace=${encodeURIComponent("main@nowhere")}`,
      { userId: USER },
    );
    expect(unknown.status).toBe(404);
  });
});

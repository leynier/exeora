import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { call as request } from "./clients-fixtures.js";

/**
 * The same thing as `locations.workers.test.ts`, through the routes: what the
 * CLI and the dashboard send, and what they are told.
 */

const USER = "usr_api_locations";
const LAPTOP = "dev_api_laptop";
const DESKTOP = "dev_api_desktop";

const call = (path: string, method = "GET", body?: unknown) =>
  request(path, { method, userId: USER, ...(body === undefined ? {} : { body }) });

interface Location {
  id: string;
  slug: string;
  kind: string;
  default: boolean;
  status: string;
  localPath: string | null;
  deviceId: string | null;
}

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "api-locations@example.com", plan: "pro", cloudEnabled: true })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
    ])
    .run();
});

async function add(deviceId: string, slug: string, repoUrl?: string) {
  const response = await call("/api/projects", "POST", {
    deviceId,
    name: slug,
    slug,
    localPath: `/home/me/code/${slug}`,
    ...(repoUrl ? { repoUrl, defaultBranch: "main" } : {}),
  });
  return {
    status: response.status,
    body: (await response.json()) as { id: string; slug: string; location: string; error?: string },
  };
}

const locationsOf = async (projectId: string) =>
  ((await (await call(`/api/projects/${projectId}/locations`)).json()) as { locations: Location[] })
    .locations;

describe("projects and their locations over the API", () => {
  it("answers the second machine with the project it joined", async () => {
    const first = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    const second = await add(DESKTOP, "api", "git@github.com:acme/api.git");

    expect(first).toMatchObject({ status: 201, body: { location: "created" } });
    expect(second).toMatchObject({ status: 200, body: { id: first.body.id, location: "joined" } });

    const listed = (await (await call("/api/projects")).json()) as Array<{
      id: string;
      repoUrl: string | null;
      deviceId: string;
      locations: Location[];
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      repoUrl: "https://github.com/acme/api.git",
      deviceId: LAPTOP,
    });
    expect(listed[0]?.locations.map((location) => location.slug)).toEqual(["laptop", "desktop"]);
  });

  it("refuses to take a project from the machine it is on", async () => {
    await add(LAPTOP, "notes");
    const taken = await add(DESKTOP, "notes");

    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("slug_taken");
  });

  it("adds a machine that will clone later, and hears from it when it has", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");

    const added = await call(`/api/projects/${project.id}/locations`, "POST", {
      deviceId: DESKTOP,
    });
    expect(added.status).toBe(201);
    expect((await locationsOf(project.id)).find((location) => location.slug === "desktop")).toEqual(
      expect.objectContaining({ status: "pending", localPath: null, default: false }),
    );

    const reported = await call(`/api/projects/${project.id}/locations/${DESKTOP}`, "PUT", {
      status: "ready",
      localPath: "/home/me/exeora/api",
    });
    expect(reported.status).toBe(200);
    expect((await locationsOf(project.id)).find((location) => location.slug === "desktop")).toEqual(
      expect.objectContaining({ status: "ready", localPath: "/home/me/exeora/api" }),
    );
  });

  it("does not offer another machine a directory that has no repository", async () => {
    const { body: project } = await add(LAPTOP, "notes");

    const added = await call(`/api/projects/${project.id}/locations`, "POST", {
      deviceId: DESKTOP,
    });

    expect(added.status).toBe(422);
    expect(await added.json()).toMatchObject({ error: "no_repository" });
  });

  it("moves the default, and will not remove it or the last location", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    await add(DESKTOP, "api", "https://github.com/acme/api.git");
    const [laptop, desktop] = await locationsOf(project.id);
    if (!laptop || !desktop) throw new Error("two locations were expected");

    const stays = await call(`/api/projects/${project.id}/locations/${laptop.id}`, "DELETE");
    expect(stays.status).toBe(409);
    expect(await stays.json()).toMatchObject({ error: "default_location" });

    const moved = await call(`/api/projects/${project.id}/default-location`, "PUT", {
      locationId: desktop.id,
    });
    expect(moved.status).toBe(200);
    expect((await locationsOf(project.id)).map((location) => location.default)).toEqual([
      false,
      true,
    ]);

    const removed = await call(`/api/projects/${project.id}/locations/${laptop.id}`, "DELETE");
    expect(removed.status).toBe(200);
    const left = await locationsOf(project.id);
    expect(left.map((location) => location.slug)).toEqual(["desktop"]);

    const last = await call(`/api/projects/${project.id}/locations/${left[0]?.id}`, "DELETE");
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: "last_location" });
  });

  it("records a workspace on the machine that reported it", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    await add(DESKTOP, "api", "https://github.com/acme/api.git");
    const put = (id: string, deviceId: string | undefined, slug: string) =>
      call(`/api/projects/${project.id}/workspaces/${id}`, "PUT", {
        slug,
        name: slug,
        branch: slug,
        localPath: `/worktrees/${slug}`,
        managed: true,
        ...(deviceId ? { deviceId } : {}),
      });

    const onDesktop = await put("wsp_apidesktop", DESKTOP, "fix-a");
    expect(onDesktop.status).toBe(200);
    expect(await onDesktop.json()).toMatchObject({
      deviceId: DESKTOP,
      machine: "Desktop",
      cloud: false,
    });

    // A CLI from before locations says nothing, and is on the default machine.
    const older = await put("wsp_apiolder", undefined, "fix-b");
    expect(await older.json()).toMatchObject({ deviceId: LAPTOP, machine: "Laptop" });

    await db(env)
      .insert(schema.devices)
      .values({ id: "dev_api_stranger", userId: USER, name: "Server", platform: "linux" })
      .run();
    const elsewhere = await put("wsp_apistranger", "dev_api_stranger", "fix-c");
    expect(elsewhere.status).toBe(409);
    expect(await elsewhere.json()).toEqual({ error: "not_a_location" });
  });

  it("lists every machine with the projects it holds", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    await add(DESKTOP, "api", "https://github.com/acme/api.git");

    const { machines } = (await (await call("/api/machines")).json()) as {
      machines: Array<{
        deviceId: string;
        kind: string;
        state: string;
        projects: Array<{ projectId: string; default: boolean }>;
      }>;
    };

    expect(machines.map((machine) => [machine.deviceId, machine.kind, machine.state])).toEqual([
      [LAPTOP, "local", "offline"],
      [DESKTOP, "local", "offline"],
    ]);
    expect(machines[0]?.projects).toEqual([
      expect.objectContaining({ projectId: project.id, default: true }),
    ]);
    expect(machines[1]?.projects).toEqual([
      expect.objectContaining({ projectId: project.id, default: false }),
    ]);
  });

  it("puts a repository the account already has on Cloud, rather than making it again", async () => {
    const { body: project } = await add(LAPTOP, "api", "git@github.com:acme/api.git");

    const response = await request("/api/cloud/projects", {
      method: "POST",
      userId: USER,
      bindings: { SPRITES_TOKEN: "org/1/secret", LATEST_CLI_VERSION: "0.18.0" },
      body: {
        name: "API again",
        slug: "api-again",
        repoUrl: "https://github.com/acme/api.git",
        defaultBranch: "main",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: project.id, location: "joined" });
    expect(
      (await locationsOf(project.id)).map((location) => [location.slug, location.deviceId]),
    ).toEqual([
      ["laptop", LAPTOP],
      // On Cloud, and holding no machine until a workspace is made there.
      ["cloud", null],
    ]);
    const all = await db(env)
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.userId, USER))
      .all();
    expect(all).toHaveLength(1);
  });
});

describe("what the review of locations found", () => {
  const put = (projectId: string, id: string, deviceId: string, slug: string) =>
    call(`/api/projects/${projectId}/workspaces/${id}`, "PUT", {
      slug,
      name: slug,
      branch: slug,
      localPath: `/worktrees/${slug}`,
      managed: true,
      deviceId,
    });

  it("gives the same branch on a second machine a slug of its own", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    await add(DESKTOP, "api", "https://github.com/acme/api.git");

    const first = await put(project.id, "wsp_sluglaptop", LAPTOP, "fix-login");
    const second = await put(project.id, "wsp_slugdesktop", DESKTOP, "fix-login");
    // It reports again, as the CLI does on every sync, and keeps what it has.
    const again = await put(project.id, "wsp_slugdesktop", DESKTOP, "fix-login");
    const clash = await put(project.id, "wsp_slugother", DESKTOP, "fix-login");

    expect(await first.json()).toMatchObject({ slug: "fix-login", deviceId: LAPTOP });
    expect(await second.json()).toMatchObject({ slug: "fix-login-desktop", deviceId: DESKTOP });
    expect(await again.json()).toMatchObject({ slug: "fix-login-desktop" });
    // Two on the same machine asking for one slug is a conflict, as it was.
    expect(clash.status).toBe(409);
  });

  it("keeps a project that is also on Cloud when its only machine is deleted", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    const bindings = { SPRITES_TOKEN: "org/1/secret", LATEST_CLI_VERSION: "0.18.0" };
    const onCloud = await request(`/api/projects/${project.id}/locations`, {
      method: "POST",
      userId: USER,
      bindings,
      body: { kind: "cloud" },
    });
    expect(onCloud.status).toBe(201);

    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, LAPTOP))
      .run();
    const deleted = await request(`/api/devices/${LAPTOP}/permanently`, {
      method: "DELETE",
      userId: USER,
      bindings,
    });

    expect(deleted.status).toBe(200);
    const left = await locationsOf(project.id);
    // Cloud was given a machine for the project root, and became the default.
    expect(left).toEqual([
      expect.objectContaining({ slug: "cloud", default: true, deviceId: expect.any(String) }),
    ]);
  });

  it("corrects a repository key the migration wrote its own way", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://www.github.com/acme/api.git");
    await db(env)
      .update(schema.projects)
      .set({ repoKey: "www.github.com/acme/api" })
      .where(eq(schema.projects.id, project.id))
      .run();

    const joined = await add(DESKTOP, "api", "git@github.com:acme/api.git");

    expect(joined).toMatchObject({ status: 200, body: { id: project.id, location: "joined" } });
  });
});

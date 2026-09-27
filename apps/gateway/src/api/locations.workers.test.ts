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

  it("moves the default, and will not remove it while the project lives elsewhere", async () => {
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
  });

  it("keeps a repository that lost the only place it lived, and gives it the next one", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    const [only] = await locationsOf(project.id);

    const last = await call(`/api/projects/${project.id}/locations/${only?.id}`, "DELETE");
    expect(last.status).toBe(200);

    const listed = async () =>
      (
        (await (await call("/api/projects")).json()) as Array<{
          id: string;
          nowhere: boolean;
          deviceId: string;
          mcpUrl: string;
          locations: Location[];
        }>
      ).find((entry) => entry.id === project.id);
    expect(await listed()).toMatchObject({ nowhere: true, locations: [] });
    expect((await listed())?.mcpUrl).toContain(project.id);
    // The machine that stands for no machine is not one of the account's.
    const machines = (await (await call("/api/devices")).json()) as Array<{ id: string }>;
    expect(machines.map((machine) => machine.id).sort()).toEqual([DESKTOP, LAPTOP].sort());

    // The same repository from another machine is the same project, and the
    // machine becomes where it lives.
    const back = await add(DESKTOP, "whatever", "git@github.com:acme/api.git");
    expect(back).toMatchObject({ status: 200, body: { id: project.id, location: "joined" } });
    expect(await listed()).toMatchObject({
      nowhere: false,
      deviceId: DESKTOP,
      locations: [expect.objectContaining({ slug: "desktop", default: true })],
    });
  });

  it("keeps a repository whose last place goes while its default is a machine that was removed", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    await add(DESKTOP, "api", "https://github.com/acme/api.git");
    // Revoked and still listed: the default is somewhere nothing answers.
    expect((await call(`/api/devices/${LAPTOP}`, "DELETE")).status).toBe(200);
    const desktop = (await locationsOf(project.id)).find((entry) => entry.slug === "desktop");

    const last = await call(`/api/projects/${project.id}/locations/${desktop?.id}`, "DELETE");
    expect(last.status).toBe(200);

    const listed = async () =>
      (
        (await (await call("/api/projects")).json()) as Array<{
          id: string;
          nowhere: boolean;
          deviceId: string;
        }>
      ).find((entry) => entry.id === project.id);
    expect(await listed()).toMatchObject({ nowhere: true });

    // And the next machine it is given is where it lives.
    await db(env)
      .insert(schema.devices)
      .values({ id: "dev_api_server", userId: USER, name: "Server", platform: "linux" })
      .run();
    const back = await add("dev_api_server", "api", "https://github.com/acme/api.git");
    expect(back).toMatchObject({ status: 200, body: { id: project.id } });
    expect(await listed()).toMatchObject({ nowhere: false, deviceId: "dev_api_server" });
  });

  it("takes the workspaces that name no machine with the last place, on Exeora Cloud too", async () => {
    const bindings = { SPRITES_TOKEN: "org/1/secret", LATEST_CLI_VERSION: "0.18.0" };
    const cloud = (path: string, method: string, body?: unknown) =>
      request(path, { method, userId: USER, bindings, ...(body === undefined ? {} : { body }) });
    const nameless = (projectId: string, id: string) =>
      db(env)
        .insert(schema.workspaces)
        .values({
          id,
          projectId,
          slug: id,
          name: id,
          branch: id,
          localPath: `/worktrees/${id}`,
          managed: true,
          deviceId: null,
        })
        .run();
    const workspacesOf = (projectId: string) =>
      db(env)
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.projectId, projectId))
        .all();
    const cloudOf = async (projectId: string) =>
      (await locationsOf(projectId)).find((entry) => entry.kind === "cloud");

    // Cloud is the default, with an instance for the project root.
    const { body: first } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    expect(
      (await cloud(`/api/projects/${first.id}/locations`, "POST", { kind: "cloud" })).status,
    ).toBe(201);
    const made = await cloud(`/api/projects/${first.id}/default-location`, "PUT", {
      locationId: (await cloudOf(first.id))?.id,
    });
    expect(made.status).toBe(200);
    const laptop = (await locationsOf(first.id)).find((entry) => entry.slug === "laptop");
    expect((await call(`/api/projects/${first.id}/locations/${laptop?.id}`, "DELETE")).status).toBe(
      200,
    );
    await nameless(first.id, "wsp_apicloudold");

    const gone = await cloud(
      `/api/projects/${first.id}/locations/${(await cloudOf(first.id))?.id}`,
      "DELETE",
    );
    expect(gone.status).toBe(202);
    expect(await workspacesOf(first.id)).toEqual([]);

    // The default is a machine that was removed, and Cloud the one place left.
    const { body: second } = await add(DESKTOP, "web", "https://github.com/acme/web.git");
    expect(
      (await cloud(`/api/projects/${second.id}/locations`, "POST", { kind: "cloud" })).status,
    ).toBe(201);
    await nameless(second.id, "wsp_webdesktopold");
    expect((await call(`/api/devices/${DESKTOP}`, "DELETE")).status).toBe(200);

    const left = await cloud(
      `/api/projects/${second.id}/locations/${(await cloudOf(second.id))?.id}`,
      "DELETE",
    );
    expect(left.status).toBe(202);
    expect(await workspacesOf(second.id)).toEqual([]);
    const listed = (await (await call("/api/projects")).json()) as Array<{
      id: string;
      nowhere: boolean;
    }>;
    expect(listed.find((entry) => entry.id === second.id)).toMatchObject({ nowhere: true });
  });

  it("will not take a directory with no remote off the one machine it is on", async () => {
    const { body: project } = await add(LAPTOP, "notes");
    const [only] = await locationsOf(project.id);

    const last = await call(`/api/projects/${project.id}/locations/${only?.id}`, "DELETE");

    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: "last_location" });
  });

  it("keeps the repositories of a machine that is deleted, and lets its directories go", async () => {
    const { body: repository } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    const { body: directory } = await add(LAPTOP, "notes");
    await call(`/api/projects/${repository.id}/workspaces/wsp_apikept`, "PUT", {
      slug: "fix-a",
      name: "fix-a",
      branch: "fix-a",
      localPath: "/worktrees/fix-a",
      managed: true,
    });

    expect((await call(`/api/devices/${LAPTOP}`, "DELETE")).status).toBe(200);
    expect((await call(`/api/devices/${LAPTOP}/permanently`, "DELETE")).status).toBe(200);

    const left = (await (await call("/api/projects")).json()) as Array<{
      id: string;
      nowhere: boolean;
      locations: Location[];
    }>;
    expect(left.map((project) => project.id)).toEqual([repository.id]);
    expect(left[0]).toMatchObject({ nowhere: true, locations: [] });
    expect(left.some((project) => project.id === directory.id)).toBe(false);
    // What was on the machine went with it: a workspace is a working copy.
    const workspaces = await db(env)
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.projectId, repository.id))
      .all();
    expect(workspaces).toEqual([]);
  });

  it("does not list, revoke or delete the machine that stands for no machine", async () => {
    const { body: project } = await add(LAPTOP, "api", "https://github.com/acme/api.git");
    const [only] = await locationsOf(project.id);
    await call(`/api/projects/${project.id}/locations/${only?.id}`, "DELETE");
    const nowhere = (
      await db(env)
        .select({ deviceId: schema.projects.deviceId })
        .from(schema.projects)
        .where(eq(schema.projects.id, project.id))
        .get()
    )?.deviceId;
    if (!nowhere) throw new Error("the project was expected to stay");

    const { machines } = (await (await call("/api/machines")).json()) as {
      machines: Array<{ deviceId: string }>;
    };
    expect(machines.map((machine) => machine.deviceId)).not.toContain(nowhere);
    expect((await call(`/api/devices/${nowhere}`, "DELETE")).status).toBe(404);
    expect((await call(`/api/devices/${nowhere}/permanently`, "DELETE")).status).toBe(404);
    // Nothing is registered onto it either.
    const onto = await call("/api/projects", "POST", {
      deviceId: nowhere,
      name: "other",
      slug: "other",
      localPath: "/home/me/code/other",
    });
    expect(onto.status).toBe(409);
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
    // Cloud is the default, and nothing was made for it: the instance for
    // the project root comes with the first call that needs it, so the room
    // left on the plan never decides whether a machine can be deleted.
    expect(left).toEqual([
      expect.objectContaining({
        slug: "cloud",
        default: true,
        deviceId: null,
        state: "no instance",
      }),
    ]);

    const started = await request(`/api/projects/${project.id}/default-location`, {
      method: "PUT",
      userId: USER,
      bindings,
      body: { locationId: left[0]?.id },
    });
    expect(started.status).toBe(200);
    const after = ((await started.json()) as { locations: Location[] }).locations;
    expect(after).toEqual([
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

import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { call as request } from "./clients-fixtures.js";

/**
 * A repository that loses the last place it lived, through the routes: what
 * the CLI and the dashboard send when a location or a machine is taken away,
 * and what is left of the project afterwards.
 */

const USER = "usr_api_nowhere";
const LAPTOP = "dev_apn_laptop";
const DESKTOP = "dev_apn_desktop";

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
    .values({ id: USER, email: "api-nowhere@example.com", plan: "pro", cloudEnabled: true })
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

describe("a repository that loses the last place it lived", () => {
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
      .values({ id: "dev_apn_server", userId: USER, name: "Server", platform: "linux" })
      .run();
    const back = await add("dev_apn_server", "api", "https://github.com/acme/api.git");
    expect(back).toMatchObject({ status: 200, body: { id: project.id } });
    expect(await listed()).toMatchObject({ nowhere: false, deviceId: "dev_apn_server" });
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
});

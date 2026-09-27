import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { permanentlyDeleteDevice } from "./api/ops.js";
import { accountProjects, resolveAccountTarget, resolveTarget } from "./client-targets.js";
import { addCloudLocation, createCloudRoot } from "./cloud/location.js";
import { revokeOwnedDevice } from "./cloud/revoke.js";
import { db, schema } from "./db/client.js";
import { locationsOf, setDefaultLocation } from "./locations.js";
import { noDefault } from "./no-default.js";
import { isNowhere, nowhereId } from "./nowhere.js";
import { registerProject } from "./project-register.js";
import { placeWorkspaceTool } from "./workspace-placement.js";

/**
 * A repository outlives the last place it lived.
 *
 * Its address, its policy and the clients let into it are the account's. What
 * a machine takes with it when it goes is its own copy, and the directories
 * that were never anything else.
 */

const USER = "usr_nowhere";
const LAPTOP = "dev_nw_laptop";
const CLIENT = "client_nowhere";
const REPO = {
  repoUrl: "https://github.com/acme/api.git",
  repoKey: "github.com/acme/api",
  defaultBranch: "main",
};
const cloud = {
  ...env,
  SPRITES_TOKEN: "org/1/secret",
  LATEST_CLI_VERSION: "0.18.0",
} as unknown as Env;

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "nowhere@example.com", plan: "pro", cloudEnabled: true })
    .run();
  await database
    .insert(schema.devices)
    .values({ id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" })
    .run();
});

async function add(slug: string, repository: typeof REPO | null = REPO) {
  const made = await registerProject(
    env,
    USER,
    { deviceId: LAPTOP, name: slug, slug, localPath: `/home/me/code/${slug}` },
    repository,
  );
  if ("error" in made) throw new Error(made.error);
  await db(env)
    .insert(schema.projectClients)
    .values({
      id: `pcl_${made.id.slice(4)}`,
      userId: USER,
      projectId: made.id,
      clientId: CLIENT,
      clientName: "Agent",
      endpoint: "account",
      authorizedAt: new Date(),
    })
    .run();
  return made.id;
}

const project = (id: string) =>
  db(env).select().from(schema.projects).where(eq(schema.projects.id, id)).get();

async function locations(id: string) {
  const row = await project(id);
  if (!row) throw new Error("the project is gone");
  return (await locationsOf(env, USER, [row])).get(id) ?? [];
}

async function loseTheLaptop() {
  await db(env)
    .update(schema.devices)
    .set({ revokedAt: new Date() })
    .where(eq(schema.devices.id, LAPTOP))
    .run();
  expect(await permanentlyDeleteDevice(env, USER, LAPTOP)).toBe(true);
}

/** Puts the project on Exeora Cloud and nowhere else, with an instance for its root. */
async function onlyOnCloud(id: string) {
  expect(await addCloudLocation(cloud, USER, id)).toBe(true);
  const root = await createCloudRoot(cloud, USER, id);
  if ("error" in root) throw new Error(root.error);
  const row = await project(id);
  const onCloud = (await locations(id)).find((location) => location.kind === "cloud");
  if (!row || !onCloud) throw new Error("the project was expected on Exeora Cloud");
  expect(await setDefaultLocation(env, USER, row, onCloud)).toBe(true);
  await loseTheLaptop();
  return root.deviceId;
}

describe("a repository whose last machine is gone", () => {
  it("is kept, with what belongs to the account, and lives nowhere", async () => {
    const id = await add("api");
    const before = await project(id);

    await loseTheLaptop();

    const after = await project(id);
    expect(after).toMatchObject({
      id,
      slug: "api",
      repoKey: REPO.repoKey,
      commandPolicy: before?.commandPolicy ?? null,
      deviceId: nowhereId(USER),
    });
    expect(isNowhere(after?.deviceId)).toBe(true);
    expect(await locations(id)).toEqual([]);
    // The client that was let in still is.
    expect(
      await resolveAccountTarget(env, { userId: USER, projectId: id, clientId: CLIENT }),
    ).toMatchObject({ nowhere: true, defaultRemoved: false });
    expect(
      await resolveTarget(env, { userId: USER, projectId: id, clientId: undefined }),
    ).toMatchObject({ nowhere: true, defaultRemoved: false });
  });

  it("goes with the machine when it is a directory with no remote", async () => {
    const id = await add("notes", null);

    await loseTheLaptop();

    expect(await project(id)).toBeUndefined();
  });

  it("is listed to an agent, with nowhere to work yet", async () => {
    const id = await add("api");
    await add("notes", null);
    await loseTheLaptop();

    expect(await accountProjects(env, { userId: USER, clientId: CLIENT })).toEqual([
      {
        id,
        slug: "api",
        name: "api",
        repository: REPO.repoKey,
        machine: "nowhere",
        online: false,
        locations: [],
      },
    ]);
  });

  it("tells a call to its root how it is given a place again", async () => {
    const id = await add("api");
    await loseTheLaptop();

    const error = await noDefault(cloud, USER, id, nowhereId(USER));

    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
    expect(error.message).toContain("lives nowhere");
    expect(error.message).toContain("exeora project add");
    // Asking made nothing.
    expect(await locations(id)).toEqual([]);
  });

  it("takes the next machine it is given as its default", async () => {
    const id = await add("api");
    await loseTheLaptop();
    await db(env)
      .insert(schema.devices)
      .values({ id: "dev_nw_desktop", userId: USER, name: "Desktop", platform: "linux" })
      .run();

    const joined = await registerProject(
      env,
      USER,
      { deviceId: "dev_nw_desktop", name: "api", slug: "api", localPath: "/srv/api" },
      REPO,
    );

    expect(joined).toMatchObject({ id, location: "joined" });
    expect(await project(id)).toMatchObject({ deviceId: "dev_nw_desktop", localPath: "/srv/api" });
    expect(await locations(id)).toEqual([
      expect.objectContaining({ slug: "desktop", default: true, status: "ready" }),
    ]);
  });
});

describe("a project on Exeora Cloud whose root instance is destroyed", () => {
  it("stays, with Cloud as its default and no instance", async () => {
    const id = await add("api");
    const root = await onlyOnCloud(id);
    expect(await project(id)).toMatchObject({ deviceId: root });

    expect(await revokeOwnedDevice(cloud, USER, root)).toBe(true);

    expect(await project(id)).toMatchObject({ id, deviceId: nowhereId(USER) });
    expect(await locations(id)).toEqual([
      expect.objectContaining({
        kind: "cloud",
        slug: "cloud",
        deviceId: null,
        default: true,
        state: "no instance",
      }),
    ]);
    const cloudProject = await db(env)
      .select({ deletingAt: schema.cloudProjects.deletingAt })
      .from(schema.cloudProjects)
      .where(eq(schema.cloudProjects.projectId, id))
      .get();
    expect(cloudProject).toEqual({ deletingAt: null });
  });

  it("is given an instance again by the next call to its root", async () => {
    const id = await add("api");
    const root = await onlyOnCloud(id);
    await revokeOwnedDevice(cloud, USER, root);

    const error = await noDefault(cloud, USER, id, nowhereId(USER));

    expect(error.code).toBe("EXECUTOR_WAKING");
    const after = await project(id);
    expect(isNowhere(after?.deviceId)).toBe(false);
    expect(after?.deviceId).not.toBe(root);
    expect(await locations(id)).toEqual([
      expect.objectContaining({
        kind: "cloud",
        deviceId: after?.deviceId,
        default: true,
        state: "setting up",
      }),
    ]);
    const machine = await db(env)
      .select({ workspaceId: schema.cloudMachines.workspaceId })
      .from(schema.cloudMachines)
      .where(
        and(
          eq(schema.cloudMachines.projectId, id),
          eq(schema.cloudMachines.deviceId, after?.deviceId ?? ""),
        ),
      )
      .get();
    expect(machine).toEqual({ workspaceId: null });
  });

  it("says why when another instance cannot be made", async () => {
    const id = await add("api");
    const root = await onlyOnCloud(id);
    await revokeOwnedDevice(cloud, USER, root);
    await db(env)
      .update(schema.users)
      .set({ cloudEnabled: false })
      .where(eq(schema.users.id, USER))
      .run();

    const error = await noDefault(cloud, USER, id, nowhereId(USER));

    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
    expect(error.message).toContain("could not be made");
    expect(isNowhere((await project(id))?.deviceId)).toBe(true);
  });

  it("puts a new workspace on Cloud when nothing says where", async () => {
    const id = await add("api");
    const root = await onlyOnCloud(id);
    await revokeOwnedDevice(cloud, USER, root);

    const placed = await placeWorkspaceTool(env, {
      userId: USER,
      project: { id, deviceId: nowhereId(USER), localPath: "" },
      tool: "create_workspace",
      args: { branch: "fix/login" },
      workspace: null,
    });

    expect(placed).toMatchObject({ cloud: true, deviceId: null });
  });
});

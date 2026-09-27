import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { permanentlyDeleteDevice } from "./api/ops.js";
import { resolveTarget } from "./client-targets.js";
import { db, schema } from "./db/client.js";
import { findLocation, locationSlug, locationsOf, setDefaultLocation } from "./locations.js";
import { registerProject } from "./project-register.js";
import { placeWorkspaceTool } from "./workspace-placement.js";

/**
 * One project, several places.
 *
 * The account here has a laptop and a desktop, and what is being pinned down
 * is that a repository on both is one project, that each machine's copy is
 * its own, and that losing one machine does not take the project from the
 * other.
 */

const USER = "usr_locations";
const LAPTOP = "dev_loc_laptop";
const DESKTOP = "dev_loc_desktop";
const REPO = {
  repoUrl: "https://github.com/acme/api.git",
  repoKey: "github.com/acme/api",
  defaultBranch: "main",
};

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "locations@example.com", plan: "pro", cloudEnabled: true })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
    ])
    .run();
});

const add = (deviceId: string, slug: string, repository: typeof REPO | null = REPO) =>
  registerProject(
    env,
    USER,
    { deviceId, name: slug, slug, localPath: `/home/me/code/${slug}` },
    repository,
  );

async function project(id: string) {
  const row = await db(env).select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!row) throw new Error("the project is gone");
  return row;
}

const locations = async (id: string) =>
  (await locationsOf(env, USER, [await project(id)])).get(id) ?? [];

const count = async () =>
  (await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all())
    .length;

describe("registering a checkout", () => {
  it("makes a project with the machine as its one location", async () => {
    const made = await add(LAPTOP, "api");

    expect(made).toMatchObject({ created: true, location: "created", slug: "api" });
    if ("error" in made) throw new Error(made.error);
    expect(await locations(made.id)).toEqual([
      expect.objectContaining({
        name: "Laptop",
        slug: "laptop",
        kind: "local",
        default: true,
        status: "ready",
        localPath: "/home/me/code/api",
      }),
    ]);
    expect(await project(made.id)).toMatchObject({ repoKey: REPO.repoKey, defaultBranch: "main" });
  });

  it("joins the project of the same repository, whatever the directory is called", async () => {
    const first = await add(LAPTOP, "api");
    const second = await add(DESKTOP, "api-checkout", {
      ...REPO,
      repoUrl: "git@github.com:acme/api.git",
    });

    if ("error" in first || "error" in second) throw new Error("registration failed");
    expect(second).toMatchObject({ id: first.id, slug: "api", created: false, location: "joined" });
    expect(await count()).toBe(1);

    const where = await locations(first.id);
    expect(where.map((location) => [location.slug, location.default])).toEqual([
      ["laptop", true],
      ["desktop", false],
    ]);
    // The second machine did not take the project: it is where it was.
    expect((await project(first.id)).deviceId).toBe(LAPTOP);
  });

  it("refuses a name that belongs to something else on another machine", async () => {
    const first = await add(LAPTOP, "api", null);
    const taken = await add(DESKTOP, "api", null);

    expect(taken).toMatchObject({ error: "slug_taken", machine: "Laptop" });
    if ("error" in first) throw new Error(first.error);
    // It used to move here without a word. It stays.
    expect((await project(first.id)).deviceId).toBe(LAPTOP);
    expect(await count()).toBe(1);
  });

  it("brings a registration made again on the same machine up to date", async () => {
    const first = await add(LAPTOP, "api", null);
    const again = await registerProject(
      env,
      USER,
      { deviceId: LAPTOP, name: "API", slug: "api", localPath: "/home/me/moved/api" },
      REPO,
    );

    if ("error" in first) throw new Error(first.error);
    expect(again).toMatchObject({ id: first.id, created: false, location: "updated" });
    // A project registered before remotes were sent learns its repository,
    // which is what lets the next machine join it.
    expect(await project(first.id)).toMatchObject({
      name: "API",
      localPath: "/home/me/moved/api",
      repoKey: REPO.repoKey,
    });
  });

  it("gives a project back to a machine that was registered again", async () => {
    const first = await add(LAPTOP, "notes", null);
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, LAPTOP))
      .run();

    const back = await add(DESKTOP, "notes", null);

    if ("error" in first) throw new Error(first.error);
    expect(back).toMatchObject({ id: first.id, created: false });
    expect((await project(first.id)).deviceId).toBe(DESKTOP);
  });
});

describe("the locations of a project", () => {
  it("gives a project from before locations the one it has always had", async () => {
    await db(env)
      .insert(schema.projects)
      .values({
        id: "prj_loc_old",
        userId: USER,
        deviceId: LAPTOP,
        name: "old",
        slug: "old",
        localPath: "/home/me/old",
      })
      .run();

    expect(await locations("prj_loc_old")).toEqual([
      expect.objectContaining({ slug: "laptop", default: true, localPath: "/home/me/old" }),
    ]);
  });

  it("names machines so that none answers to `cloud` or `main`", () => {
    expect(locationSlug("Leynier's MacBook Pro")).toBe("leynier-s-macbook-pro");
    expect(locationSlug("cloud")).toBe("cloud-machine");
    expect(locationSlug("Main")).toBe("main-machine");
    expect(locationSlug("  ")).toBe("machine-machine");
  });

  it("finds a location by what a person or an agent would call it", async () => {
    const made = await add(LAPTOP, "api");
    await add(DESKTOP, "api");
    if ("error" in made) throw new Error(made.error);
    const where = await locations(made.id);

    expect(findLocation(where, undefined)?.slug).toBe("laptop");
    expect(findLocation(where, "desktop")?.deviceId).toBe(DESKTOP);
    expect(findLocation(where, "Desktop")?.deviceId).toBe(DESKTOP);
    expect(findLocation(where, DESKTOP)?.slug).toBe("desktop");
    expect(findLocation(where, "server")).toBeUndefined();
  });

  it("keeps older workspaces on their machine when the default moves", async () => {
    const made = await add(LAPTOP, "api");
    await add(DESKTOP, "api");
    if ("error" in made) throw new Error(made.error);
    await db(env)
      .insert(schema.workspaces)
      .values({
        id: "wsp_loc_legacy",
        projectId: made.id,
        slug: "fix-login",
        name: "fix/login",
        branch: "fix/login",
        localPath: "/home/me/worktrees/fix-login",
        managed: true,
      })
      .run();

    const desktop = findLocation(await locations(made.id), "desktop");
    if (!desktop) throw new Error("no desktop");
    expect(await setDefaultLocation(env, USER, await project(made.id), desktop)).toBe(true);

    expect((await project(made.id)).deviceId).toBe(DESKTOP);
    const workspace = await db(env)
      .select({ deviceId: schema.workspaces.deviceId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, "wsp_loc_legacy"))
      .get();
    expect(workspace?.deviceId).toBe(LAPTOP);
  });
});

describe("losing a machine", () => {
  it("keeps a project that lives elsewhere, and moves its default there", async () => {
    const shared = await add(LAPTOP, "api");
    await add(DESKTOP, "api");
    const alone = await add(LAPTOP, "notes", null);
    if ("error" in shared || "error" in alone) throw new Error("registration failed");

    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, LAPTOP))
      .run();

    // Revoked, not yet deleted: the project is still reachable through the
    // desktop, and only its root says the default is gone.
    expect(
      await resolveTarget(env, { userId: USER, projectId: shared.id, clientId: undefined }),
    ).toMatchObject({ defaultRemoved: true });
    // The one that lived only there is gone for every caller, at once.
    expect(
      await resolveTarget(env, { userId: USER, projectId: alone.id, clientId: undefined }),
    ).toBeNull();

    expect(await permanentlyDeleteDevice(env, USER, LAPTOP)).toBe(true);

    expect(await project(shared.id)).toMatchObject({
      deviceId: DESKTOP,
      localPath: "/home/me/code/api",
    });
    expect((await locations(shared.id)).map((location) => location.slug)).toEqual(["desktop"]);
    expect(await count()).toBe(1);
  });
});

describe("placing a workspace tool", () => {
  async function shared() {
    const made = await add(LAPTOP, "api");
    await add(DESKTOP, "api");
    if ("error" in made) throw new Error(made.error);
    return project(made.id);
  }

  const place = async (
    args: unknown,
    workspace: Parameters<typeof placeWorkspaceTool>[1]["workspace"] = null,
  ) =>
    placeWorkspaceTool(env, {
      userId: USER,
      project: await shared(),
      tool: "create_workspace",
      args,
      workspace,
    });

  it("goes to the default location when nothing is said", async () => {
    expect(await place({ branch: "fix/a" })).toMatchObject({
      deviceId: LAPTOP,
      cloud: false,
      args: { branch: "fix/a" },
    });
  });

  it("goes where it is told, and never tells the machine", async () => {
    const placed = await place({ branch: "fix/a", where: "Desktop" });

    expect(placed).toMatchObject({ deviceId: DESKTOP, cloud: false });
    expect(placed.args).toEqual({ branch: "fix/a" });
  });

  it("treats cloud as a place the project can be put, before it is there", async () => {
    expect(await place({ branch: "fix/a", where: "cloud" })).toMatchObject({
      deviceId: null,
      cloud: true,
    });
  });

  it("names the locations when it was told one the project is not on", async () => {
    await expect(place({ branch: "fix/a", where: "server" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
      message: expect.stringContaining("laptop, desktop"),
    });
  });

  it("makes a workspace beside the one it starts from", async () => {
    const beside = await place(
      { branch: "fix/b" },
      { id: "wsp_x", slug: "fix-a", deviceId: DESKTOP },
    );
    expect(beside.deviceId).toBe(DESKTOP);

    await expect(
      place(
        { branch: "fix/b", where: "laptop" },
        { id: "wsp_x", slug: "fix-a", deviceId: DESKTOP },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });
});

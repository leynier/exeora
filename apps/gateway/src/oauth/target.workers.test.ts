import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import {
  authScopeFromResource,
  ownedProjectIds,
  projectIdFromResource,
  resolveAccountTarget,
  resolveAuthTarget,
} from "./target.js";

/**
 * Naming what a token is for.
 *
 * The consent screen tells someone which project and which machine they are
 * about to hand to an agent, and it reads that from the RFC 8707 `resource`
 * parameter. Two things must hold: it must not name a project the request did
 * not ask for, and it must not name one belonging to somebody else.
 */

const OWNER = "usr_target_owner";
const STRANGER = "usr_target_stranger";

async function seed() {
  const database = db(env);

  for (const id of [OWNER, STRANGER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: OWNER, email: "owner@example.com" },
      { id: STRANGER, email: "stranger@example.com" },
    ])
    .run();

  await database
    .insert(schema.devices)
    .values({ id: "dev_t", userId: OWNER, name: "minipc", platform: "linux" })
    .run();

  await database
    .insert(schema.projects)
    .values({
      id: "prj_t",
      userId: OWNER,
      deviceId: "dev_t",
      name: "exeora",
      slug: "exeora-t",
      localPath: "/home/you/work/exeora",
    })
    .run();
}

describe("reading the project id out of a resource", () => {
  it("takes it from an MCP endpoint URL", () => {
    expect(projectIdFromResource("https://exeora.dev/p/prj_abc/mcp")).toBe("prj_abc");
  });

  it("accepts the array form, since RFC 8707 allows repeats", () => {
    expect(projectIdFromResource(["https://exeora.dev/p/prj_abc/mcp"])).toBe("prj_abc");
  });

  it("ignores anything that is not one of our endpoints", () => {
    for (const resource of [
      undefined,
      "",
      "not a url",
      "https://exeora.dev/",
      "https://exeora.dev/p/prj_abc",
      "https://exeora.dev/p/prj_abc/mcp/extra",
      "https://exeora.dev/api/devices",
      "https://evil.example/p/prj_abc/mcp/../../",
    ]) {
      expect(projectIdFromResource(resource)).toBeNull();
    }
  });
});

describe("telling the two endpoints apart", () => {
  it("reads a project URL as one project", () => {
    expect(authScopeFromResource("https://exeora.dev/p/prj_abc/mcp")).toEqual({
      kind: "project",
      projectId: "prj_abc",
    });
  });

  it("reads the account URL as the whole account", () => {
    expect(authScopeFromResource("https://exeora.dev/mcp")).toEqual({ kind: "account" });
  });

  // The account URL decides how much a consent screen is about to grant, so
  // anything that merely resembles it has to miss rather than be read loosely.
  it("refuses anything that only looks like the account URL", () => {
    for (const resource of [
      "https://exeora.dev/mcp/",
      "https://exeora.dev/mcpx",
      "https://exeora.dev/mcp/extra",
      "https://exeora.dev/api/mcp",
    ]) {
      expect(authScopeFromResource(resource)).toBeNull();
    }
  });

  it("keeps a project token out of the account scope, and the reverse", () => {
    expect(authScopeFromResource("https://exeora.dev/p/prj_abc/mcp")).not.toEqual({
      kind: "account",
    });
    expect(projectIdFromResource("https://exeora.dev/mcp")).toBeNull();
  });

  // `resource` may be sent more than once, and the token's audience then names
  // every value. A project's own URL has to win whichever order they arrive in:
  // that endpoint lets a client with no row through, so answering with the
  // account screen would consent to a list of ticks while handing out a token
  // still good for a project nobody was asked about.
  it("answers a mixed resource list with the project, not the account", () => {
    const project = { kind: "project", projectId: "prj_abc" };

    expect(
      authScopeFromResource(["https://exeora.dev/mcp", "https://exeora.dev/p/prj_abc/mcp"]),
    ).toEqual(project);

    expect(
      authScopeFromResource(["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev/mcp"]),
    ).toEqual(project);
  });
});

describe("the projects an account consent may offer", () => {
  it("lists every project of the user, ticking the ones already granted", async () => {
    await seed();

    await db(env)
      .insert(schema.projectClients)
      .values({
        id: "pcl_t_account",
        userId: OWNER,
        projectId: "prj_t",
        clientId: "cli_t",
        endpoint: "account",
        authorizedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    expect(await resolveAccountTarget(env, OWNER, "cli_t")).toEqual([
      {
        id: "prj_t",
        project: "exeora",
        machine: "minipc",
        localPath: "/home/you/work/exeora",
        granted: true,
      },
    ]);
  });

  // Access given through a project's own URL is a different consent, so it must
  // not arrive pre-ticked here: unticking a box would then revoke something this
  // screen never granted.
  it("does not tick a project granted through its own URL", async () => {
    await seed();

    await db(env)
      .insert(schema.projectClients)
      .values({
        id: "pcl_t_project",
        userId: OWNER,
        projectId: "prj_t",
        clientId: "cli_t",
        endpoint: "project",
        authorizedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    const offered = await resolveAccountTarget(env, OWNER, "cli_t");
    expect(offered.map((entry) => entry.granted)).toEqual([false]);
  });

  it("shows a stranger nothing", async () => {
    await seed();
    expect(await resolveAccountTarget(env, STRANGER, "cli_t")).toEqual([]);
  });
});

describe("narrowing a submitted selection", () => {
  it("keeps the user's own and drops everything else", async () => {
    await seed();

    expect(await ownedProjectIds(env, OWNER, ["prj_t", "prj_someone_else", "prj_t"])).toEqual([
      "prj_t",
    ]);
    expect(await ownedProjectIds(env, STRANGER, ["prj_t"])).toEqual([]);
    expect(await ownedProjectIds(env, OWNER, [])).toEqual([]);
  });
});

describe("resolving it for display", () => {
  it("names the project, the machine and the directory", async () => {
    await seed();

    expect(await resolveAuthTarget(env, "https://exeora.dev/p/prj_t/mcp", OWNER)).toEqual({
      project: "exeora",
      machine: "minipc",
      localPath: "/home/you/work/exeora",
    });
  });

  it("says nothing about a project owned by someone else", async () => {
    await seed();

    // Not an authorization decision, which happens per call at the MCP
    // endpoint. It is about not printing another account's project name on a
    // screen anyone can reach with a crafted resource.
    expect(await resolveAuthTarget(env, "https://exeora.dev/p/prj_t/mcp", STRANGER)).toBeNull();
  });

  it("says nothing when the project does not exist", async () => {
    await seed();
    expect(await resolveAuthTarget(env, "https://exeora.dev/p/prj_gone/mcp", OWNER)).toBeNull();
  });

  it("says nothing when no resource was requested", async () => {
    await seed();
    expect(await resolveAuthTarget(env, undefined, OWNER)).toBeNull();
  });
});

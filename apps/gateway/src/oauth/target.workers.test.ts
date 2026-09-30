import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import {
  authScopeFromResource,
  ownedProjectIds,
  projectIdFromResource,
  refusedResource,
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
  // every value. A screen can only ask about one of them, so a list is read as
  // asking for nothing rather than as whichever value it happens to show.
  it("reads more than one resource as none", () => {
    for (const resource of [
      ["https://exeora.dev/mcp", "https://exeora.dev/p/prj_abc/mcp"],
      ["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev/mcp"],
      ["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev/p/prj_other/mcp"],
      ["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev"],
      ["https://exeora.dev/mcp", "https://exeora.dev/mcp"],
      [],
    ]) {
      expect(authScopeFromResource(resource)).toBeNull();
    }
  });
});

// A token's audience is matched by path prefix, and a token with no audience is
// not checked at all. Anything short of one exact endpoint would therefore be
// good for projects the consent screen never named.
describe("refusing a request that names no single endpoint", () => {
  const mcp = ["tools:read", "tools:execute"];

  it("lets through one project URL or the account URL", () => {
    expect(refusedResource(mcp, "https://exeora.dev/p/prj_abc/mcp")).toBeNull();
    expect(refusedResource(mcp, ["https://exeora.dev/p/prj_abc/mcp"])).toBeNull();
    expect(refusedResource(["tools:read"], "https://exeora.dev/mcp")).toBeNull();
  });

  it("refuses a missing, wider or repeated resource", () => {
    for (const resource of [
      undefined,
      "https://exeora.dev",
      "https://exeora.dev/",
      "https://exeora.dev/p",
      "https://exeora.dev/p/prj_abc",
      ["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev/p/prj_other/mcp"],
      ["https://exeora.dev/p/prj_abc/mcp", "https://exeora.dev"],
    ]) {
      expect(refusedResource(mcp, resource)).toEqual(expect.any(String));
    }
  });

  it("asks nothing of a token that carries no MCP scope", () => {
    expect(refusedResource(["executor:connect", "executor:execute"], undefined)).toBeNull();
    expect(refusedResource(["dashboard:manage"], undefined)).toBeNull();
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
        repository: null,
        locations: ["minipc"],
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
      repository: null,
      locations: ["minipc"],
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

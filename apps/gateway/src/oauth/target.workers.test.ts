import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { projectIdFromResource, resolveAuthTarget } from "./target.js";

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

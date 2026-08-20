import { env } from "cloudflare:test";
import { ExeoraError } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { rememberAuthorization } from "./clients.js";
import { db, schema } from "./db/client.js";
import { resolveAccountProject } from "./index.js";

/**
 * Which repository a call on the account URL lands in.
 *
 * The one decision on this endpoint that can be wrong in a way nobody notices:
 * every other mistake refuses a call, and this one runs it somewhere else. The
 * order it resolves in is asserted here rather than left to the live path,
 * because a regression would be silent and would land in someone's files.
 */

const USER = "usr_resolve";
const OTHER = "usr_resolve_other";
const CLIENT = "client_resolve";

async function seed() {
  const database = db(env);

  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }

  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "you@example.com" },
      { id: OTHER, email: "someone@example.com" },
    ])
    .run();

  await database
    .insert(schema.devices)
    .values({ id: "dev_r", userId: USER, name: "minipc", platform: "linux" })
    .run();

  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_api",
        userId: USER,
        deviceId: "dev_r",
        name: "api",
        slug: "api-r",
        localPath: "/work/api",
      },
      {
        id: "prj_web",
        userId: USER,
        deviceId: "dev_r",
        name: "web",
        slug: "web-r",
        localPath: "/work/web",
      },
    ])
    .run();
}

/** Gives the client account-endpoint access to these projects, and only these. */
async function grant(...projectIds: string[]) {
  for (const projectId of projectIds) {
    await rememberAuthorization(env, {
      userId: USER,
      projectId,
      clientId: CLIENT,
      endpoint: "account",
      clientName: "Claude",
      clientUri: undefined,
    });
  }
}

async function revoke(projectId: string) {
  await db(env)
    .update(schema.projectClients)
    .set({ revokedAt: new Date() })
    .where(eq(schema.projectClients.projectId, projectId))
    .run();
}

const resolve = (named?: string) =>
  resolveAccountProject(env, { userId: USER, clientId: CLIENT, named });

/** The code an `ExeoraError` came back with, or what was thrown instead. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof ExeoraError ? error.code : String(error);
  }
}

describe("resolving where a call lands", () => {
  beforeEach(seed);

  it("uses the project the call names, by slug or id", async () => {
    await grant("prj_api", "prj_web");

    expect((await resolve("web-r")).id).toBe("prj_web");
    expect((await resolve("prj_web")).id).toBe("prj_web");
  });

  it("does not persist a choice between calls", async () => {
    await grant("prj_api", "prj_web");

    expect((await resolve("api-r")).id).toBe("prj_api");
    expect((await resolve("web-r")).id).toBe("prj_web");
    expect((await resolve("api-r")).id).toBe("prj_api");
  });

  it("uses the only project when there is one and the call omits it", async () => {
    await grant("prj_api");

    expect((await resolve()).id).toBe("prj_api");
  });

  it("requires a project rather than guessing between two", async () => {
    await grant("prj_api", "prj_web");

    expect(await codeOf(resolve())).toBe("INVALID_ARGUMENTS");
  });

  it("refuses a revoked named project and resolves the only one left when omitted", async () => {
    await grant("prj_api", "prj_web");
    await revoke("prj_api");

    expect(await codeOf(resolve("api-r"))).toBe("UNKNOWN_PROJECT");
    expect((await resolve()).id).toBe("prj_web");
  });

  it("requires an explicit project again once a second grant comes back", async () => {
    await grant("prj_api", "prj_web");
    await revoke("prj_api");
    await grant("prj_api");

    expect(await codeOf(resolve())).toBe("INVALID_ARGUMENTS");
    expect((await resolve("api-r")).id).toBe("prj_api");
  });

  it("refuses a connection that reaches nothing at all", async () => {
    expect(await codeOf(resolve())).toBe("FORBIDDEN");
  });

  /**
   * Not available, whatever the reason. A project that does not exist, belongs
   * to someone else, or was simply never ticked all answer the same way: the
   * difference would make ids and slugs enumerable from a connection that
   * cannot reach them.
   */
  it("refuses a named project this connection was not given", async () => {
    await grant("prj_web");

    for (const named of ["api-r", "prj_api", "prj_missing", "nonsense"]) {
      expect(await codeOf(resolve(named))).toBe("UNKNOWN_PROJECT");
    }
  });

  it("refuses a named project that was granted and then revoked", async () => {
    await grant("prj_api", "prj_web");
    await revoke("prj_api");

    expect(await codeOf(resolve("api-r"))).toBe("UNKNOWN_PROJECT");
  });

  it("never crosses into another account's project", async () => {
    await grant("prj_api");

    const stranger = resolveAccountProject(env, {
      userId: OTHER,
      clientId: CLIENT,
      named: "prj_api",
    });

    expect(await codeOf(stranger)).toBe("UNKNOWN_PROJECT");
  });
});

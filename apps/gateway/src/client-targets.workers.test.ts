import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accountProjects, resolveAccountTarget, resolveTarget } from "./client-targets.js";
import { db, schema } from "./db/client.js";

const USER = "usr_revoked_target";

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "revoked-target@example.com" })
    .run();
  await database
    .insert(schema.devices)
    .values({ id: "dev_revoked_target", userId: USER, name: "box", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: "prj_revoked_target",
      userId: USER,
      deviceId: "dev_revoked_target",
      name: "Project",
      slug: "project",
      localPath: "/work/project",
    })
    .run();
  await database
    .insert(schema.projectClients)
    .values([
      {
        id: "pcl_revoked_project",
        userId: USER,
        projectId: "prj_revoked_target",
        clientId: "client_project",
        endpoint: "project",
        authorizedAt: new Date(),
      },
      {
        id: "pcl_revoked_account",
        userId: USER,
        projectId: "prj_revoked_target",
        clientId: "client_account",
        endpoint: "account",
        authorizedAt: new Date(),
      },
    ])
    .run();
});

describe("revoked device targets", () => {
  it("removes every project endpoint from dispatch immediately", async () => {
    expect(
      await resolveTarget(env, {
        userId: USER,
        projectId: "prj_revoked_target",
        clientId: "client_project",
      }),
    ).not.toBeNull();

    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, "dev_revoked_target"))
      .run();

    expect(
      await resolveTarget(env, {
        userId: USER,
        projectId: "prj_revoked_target",
        clientId: "client_project",
      }),
    ).toBeNull();
    expect(
      await resolveAccountTarget(env, {
        userId: USER,
        projectId: "prj_revoked_target",
        clientId: "client_account",
      }),
    ).toBeNull();
    expect(await accountProjects(env, { userId: USER, clientId: "client_account" })).toEqual([]);
  });
});

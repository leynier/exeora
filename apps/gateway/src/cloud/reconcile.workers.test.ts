import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db/client.js";
import { reconcileCloud } from "./reconcile.js";

const USER = "usr_cloud_reconcile";
const PROJECT = "prj_cloud_reconcile";
const NOW = 1_800_000_000_000;
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000);

async function seedMachine(
  deviceId: string,
  status: "creating" | "ready" | "destroying",
  updatedAt: Date,
) {
  const database = db(env);
  await database
    .insert(schema.devices)
    .values({ id: deviceId, userId: USER, name: deviceId, platform: "linux", kind: "cloud" })
    .onConflictDoNothing()
    .run();
  // A teardown an earlier test set off revoked the device; every test starts
  // from a machine that is merely there.
  await database
    .update(schema.devices)
    .set({ revokedAt: null })
    .where(eq(schema.devices.id, deviceId))
    .run();
  // Each a workspace machine: a project has one main machine, whose teardown
  // reaches for its siblings, and these must not reach for each other.
  const workspaceId = `wsp_${deviceId.slice(4)}`;
  await database
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId: PROJECT,
      slug: deviceId,
      name: deviceId,
      branch: deviceId,
      localPath: "/home/sprite/workspace",
      managed: true,
      deviceId,
    })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.cloudMachines)
    .values({
      deviceId,
      userId: USER,
      projectId: PROJECT,
      workspaceId,
      spriteName: `exeora-${deviceId.slice(4)}`,
      status,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.cloudMachines.deviceId,
      set: { status, updatedAt, error: null },
    })
    .run();
}

beforeEach(async () => {
  const database = db(env);
  await database
    .insert(schema.users)
    .values({ id: USER, email: "cloud-reconcile@example.com" })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.devices)
    .values({
      id: "dev_reconcile_main",
      userId: USER,
      name: "main",
      platform: "linux",
      kind: "cloud",
    })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: USER,
      deviceId: "dev_reconcile_main",
      name: "Reconcile",
      slug: "reconcile",
      localPath: "/home/sprite/workspace",
    })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.cloudProjects)
    .values({
      projectId: PROJECT,
      userId: USER,
      repoUrl: "https://github.com/leynier/exeora.git",
      defaultBranch: "main",
    })
    .onConflictDoUpdate({ target: schema.cloudProjects.projectId, set: { deletingAt: null } })
    .run();
  await seedMachine("dev_reconcile_stuck", "creating", minutesAgo(25));
  await seedMachine("dev_reconcile_dead", "creating", minutesAgo(50));
  await seedMachine("dev_reconcile_going", "destroying", minutesAgo(15));
  await seedMachine("dev_reconcile_fine", "ready", minutesAgo(200));
});

describe("the Cloud sweep", () => {
  it("pokes the stuck, gives up on the dead, retries teardowns and deletes orphans", async () => {
    const deleted: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (target, init) => {
      const request = new Request(target, init);
      if (request.method === "DELETE") {
        deleted.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      }
      return Response.json([
        { name: "exeora-reconcile_fine", created_at: minutesAgo(200).toISOString() },
        { name: "exeora-0123456789abcdefghjkmn", created_at: minutesAgo(60).toISOString() },
        { name: "exeora-0123456789abcdefghjkmp", created_at: minutesAgo(1).toISOString() },
        // Another gateway's machines under a longer prefix, and a name of the
        // wrong shape: neither is ours, however old.
        {
          name: "exeora-staging-0123456789abcdefghjkmn",
          created_at: minutesAgo(600).toISOString(),
        },
        { name: "exeora-short", created_at: minutesAgo(600).toISOString() },
        { name: "someone-else", created_at: minutesAgo(600).toISOString() },
      ]);
    });

    const summary = await reconcileCloud(env, { fetcher, now: NOW });

    expect(summary).toEqual({
      poked: 1,
      errored: 1,
      retriedDestroys: 1,
      finishedDeletions: 0,
      orphansDeleted: 1,
    });
    expect(deleted).toEqual(["/v1/sprites/exeora-0123456789abcdefghjkmn"]);
    const dead = await db(env)
      .select({ status: schema.cloudMachines.status, error: schema.cloudMachines.error })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, "dev_reconcile_dead"))
      .get();
    expect(dead).toMatchObject({ status: "error" });
    expect(dead?.error).toContain("timed out");
    const going = await env.CLOUD_MACHINE.getByName("dev_reconcile_going").status();
    expect(going).toMatchObject({ phase: "destroy" });
  });

  it("finishes taking down a project whose removal stopped halfway", async () => {
    await db(env)
      .update(schema.cloudProjects)
      .set({ deletingAt: minutesAgo(3) })
      .where(eq(schema.cloudProjects.projectId, PROJECT))
      .run();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sprites: [] }));

    const summary = await reconcileCloud(env, { fetcher, now: NOW });

    // The ready machine and the ones still being made all go; the one
    // already going is left to its own object.
    expect(summary.finishedDeletions).toBe(3);
    const fine = await db(env)
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, "dev_reconcile_fine"))
      .get();
    expect(fine).toEqual({ status: "destroying" });
  });

  it("takes down a machine whose device was revoked without a teardown", async () => {
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: minutesAgo(2) })
      .where(eq(schema.devices.id, "dev_reconcile_fine"))
      .run();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sprites: [] }));

    const summary = await reconcileCloud(env, { fetcher, now: NOW });

    expect(summary.finishedDeletions).toBe(1);
    const fine = await db(env)
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, "dev_reconcile_fine"))
      .get();
    expect(fine).toEqual({ status: "destroying" });
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: null })
      .where(eq(schema.devices.id, "dev_reconcile_fine"))
      .run();
  });

  it("does nothing on a gateway without a Sprites token", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const summary = await reconcileCloud(
      { ...env, SPRITES_TOKEN: "" },
      {
        fetcher,
        now: NOW,
      },
    );
    expect(summary).toEqual({
      poked: 0,
      errored: 0,
      retriedDestroys: 0,
      finishedDeletions: 0,
      orphansDeleted: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

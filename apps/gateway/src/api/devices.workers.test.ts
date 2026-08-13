import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * Revoking and deleting a machine.
 *
 * They are deliberately different actions with different rules, and the rules
 * are the point: revoking is immediate and reversible, deleting must be
 * unreachable by accident and must take everything hanging off the machine
 * with it. The cascade is asserted rather than assumed, because the dialog
 * promises it in words.
 */

const USER = "usr_devices_test";
const OTHER = "usr_someone_else";

function call(path: string, options: { method?: string; userId?: string } = {}) {
  const request = new Request(`https://exeora.dev${path}`, { method: options.method ?? "GET" });
  const ctx = createExecutionContext();
  // What the OAuth provider attaches once it has validated the bearer token.
  (ctx as { props?: { userId: string; scopes: string[] } }).props = {
    userId: options.userId ?? USER,
    scopes: ["dashboard:manage"],
  };

  return api.fetch(request, env, ctx);
}

async function seed({ revoked }: { revoked: boolean }) {
  const database = db(env);

  // Self-contained rather than relying on the pool rolling storage back: one
  // delete, and the cascade takes the devices, projects and calls below it.
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
    .values({
      id: "dev_test",
      userId: USER,
      name: "minipc",
      platform: "linux",
      revokedAt: revoked ? new Date() : null,
    })
    .run();

  await database
    .insert(schema.projects)
    .values({
      id: "prj_test",
      userId: USER,
      deviceId: "dev_test",
      name: "api",
      slug: "api-test",
      localPath: "/work/api",
    })
    .run();
}

async function counts() {
  const database = db(env);
  const [devices, projects] = await Promise.all([
    database.select().from(schema.devices).where(eq(schema.devices.id, "dev_test")).all(),
    database.select().from(schema.projects).where(eq(schema.projects.id, "prj_test")).all(),
  ]);
  return { devices: devices.length, projects: projects.length };
}

describe("deleting a machine permanently", () => {
  it("refuses a machine that is still live", async () => {
    await seed({ revoked: false });

    const response = await call("/api/devices/dev_test/permanently", { method: "DELETE" });

    // 409 rather than 403: the request is allowed, the machine is in the wrong
    // state for it. Having to revoke first is what keeps this out of misclick
    // range of the button it replaces.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_revoked" });
    expect(await counts()).toEqual({ devices: 1, projects: 1 });
  });

  describe("once it is revoked", () => {
    beforeEach(async () => {
      await seed({ revoked: true });
    });

    it("takes the machine, its projects and their audit trail", async () => {
      expect(await counts()).toEqual({ devices: 1, projects: 1 });

      const response = await call("/api/devices/dev_test/permanently", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(await counts()).toEqual({ devices: 0, projects: 0 });
    });

    it("does not let one account delete another's machine", async () => {
      const response = await call("/api/devices/dev_test/permanently", {
        method: "DELETE",
        userId: OTHER,
      });

      expect(response.status).toBe(404);
      expect(await counts()).toEqual({ devices: 1, projects: 1 });
    });

    it("404s on a machine that does not exist", async () => {
      expect((await call("/api/devices/dev_nope/permanently", { method: "DELETE" })).status).toBe(
        404,
      );
    });
  });
});

/**
 * Presence on the list, which is read from D1 rather than asked of each relay.
 *
 * The case that matters is the second one: `lastSeenAt` is a checkpoint written
 * every fifteen minutes and read through a window wider than that, so on its
 * own it cannot tell a machine that left from one that is between writes. The
 * relay records the close, and this is where that recording is believed.
 */
describe("listing machines", () => {
  const RECENTLY = new Date(Date.now() - 60_000);

  async function list() {
    const response = await call("/api/devices");
    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<{ id: string; online: boolean }>;
    return Object.fromEntries(items.map((item) => [item.id, item.online]));
  }

  beforeEach(async () => {
    await seed({ revoked: false });

    await db(env)
      .insert(schema.devices)
      .values([
        {
          id: "dev_connected",
          userId: USER,
          name: "laptop",
          platform: "darwin",
          lastSeenAt: RECENTLY,
        },
        {
          id: "dev_left",
          userId: USER,
          name: "desktop",
          platform: "linux",
          lastSeenAt: RECENTLY,
          disconnectedAt: RECENTLY,
        },
        {
          id: "dev_stale",
          userId: USER,
          name: "old-box",
          platform: "linux",
          lastSeenAt: new Date(Date.now() - 60 * 60_000),
        },
        {
          id: "dev_revoked",
          userId: USER,
          name: "sold",
          platform: "win32",
          lastSeenAt: RECENTLY,
          revokedAt: new Date(),
        },
      ])
      .run();
  });

  it("reports a machine whose socket is open as online", async () => {
    expect((await list()).dev_connected).toBe(true);
  });

  it("reports a machine that disconnected as offline at once", async () => {
    // Seen a minute ago, so the checkpoint window still covers it. Only the
    // recorded close says it has gone.
    expect((await list()).dev_left).toBe(false);
  });

  it("reports a machine nobody saw leave as offline once the window passes", async () => {
    expect((await list()).dev_stale).toBe(false);
  });

  it("never reports a revoked machine as online", async () => {
    expect((await list()).dev_revoked).toBe(false);
  });
});

describe("revoking", () => {
  beforeEach(async () => {
    await seed({ revoked: false });
  });

  it("keeps the row, so the audit trail keeps its references", async () => {
    const response = await call("/api/devices/dev_test", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await counts()).toEqual({ devices: 1, projects: 1 });

    const device = await db(env)
      .select({ revokedAt: schema.devices.revokedAt })
      .from(schema.devices)
      .where(eq(schema.devices.id, "dev_test"))
      .get();
    expect(device?.revokedAt).not.toBeNull();
  });
});

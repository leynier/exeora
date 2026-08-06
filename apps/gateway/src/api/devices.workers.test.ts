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
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? USER };

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

  await database
    .insert(schema.toolCalls)
    .values({
      id: "call_test",
      userId: USER,
      projectId: "prj_test",
      tool: "read_file",
      status: "ok",
      durationMs: 12,
    })
    .run();
}

async function counts() {
  const database = db(env);
  const [devices, projects, calls] = await Promise.all([
    database.select().from(schema.devices).where(eq(schema.devices.id, "dev_test")).all(),
    database.select().from(schema.projects).where(eq(schema.projects.id, "prj_test")).all(),
    database.select().from(schema.toolCalls).where(eq(schema.toolCalls.id, "call_test")).all(),
  ]);
  return { devices: devices.length, projects: projects.length, calls: calls.length };
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
    expect(await counts()).toEqual({ devices: 1, projects: 1, calls: 1 });
  });

  describe("once it is revoked", () => {
    beforeEach(async () => {
      await seed({ revoked: true });
    });

    it("takes the machine, its projects and their audit trail", async () => {
      expect(await counts()).toEqual({ devices: 1, projects: 1, calls: 1 });

      const response = await call("/api/devices/dev_test/permanently", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(await counts()).toEqual({ devices: 0, projects: 0, calls: 0 });
    });

    it("does not let one account delete another's machine", async () => {
      const response = await call("/api/devices/dev_test/permanently", {
        method: "DELETE",
        userId: OTHER,
      });

      expect(response.status).toBe(404);
      expect(await counts()).toEqual({ devices: 1, projects: 1, calls: 1 });
    });

    it("404s on a machine that does not exist", async () => {
      expect((await call("/api/devices/dev_nope/permanently", { method: "DELETE" })).status).toBe(
        404,
      );
    });
  });
});

describe("revoking", () => {
  beforeEach(async () => {
    await seed({ revoked: false });
  });

  it("keeps the row, so the audit trail keeps its references", async () => {
    const response = await call("/api/devices/dev_test", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await counts()).toEqual({ devices: 1, projects: 1, calls: 1 });

    const device = await db(env)
      .select({ revokedAt: schema.devices.revokedAt })
      .from(schema.devices)
      .where(eq(schema.devices.id, "dev_test"))
      .get();
    expect(device?.revokedAt).not.toBeNull();
  });
});

import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./api/index.js";
import { deleteAccount } from "./api/ops.js";
import { pendingAuditDeletions, settleAuditDeletion } from "./audit-deletions.js";
import { db, schema } from "./db/client.js";

/**
 * The queue that carries a deletion from D1, where it is one statement, to the
 * archive, where it is a transaction somebody else has to commit.
 *
 * The case worth writing down is the first one: `deleteAccount` removes the
 * user row and every foreign key cascades off it. An instruction to erase that
 * hung off `users` would be erased by the erasure it describes.
 */

const USER = "usr_deletions_test";

/**
 * `deleteAccount` takes the whole `Env` because it also revokes OAuth grants,
 * and the test pool's binding set has no OAuth provider in it. The cast is the
 * same one `cimd.workers.test.ts` makes; nothing here reaches that far.
 */
const fullEnv = env as unknown as Env;

function call(path: string, options: { method?: string; userId?: string } = {}) {
  const request = new Request(`https://exeora.dev${path}`, { method: options.method ?? "GET" });
  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? USER };

  return api.fetch(request, env, ctx);
}

async function seed() {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database.delete(schema.auditDeletions).run();

  await database.insert(schema.users).values({ id: USER, email: "deletions@example.com" }).run();
  await database
    .insert(schema.devices)
    .values({
      id: "dev_del",
      userId: USER,
      name: "minipc",
      platform: "linux",
      revokedAt: new Date(),
    })
    .run();
  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_del_a",
        userId: USER,
        deviceId: "dev_del",
        name: "api",
        slug: "api",
        localPath: "/work/api",
      },
      {
        id: "prj_del_b",
        userId: USER,
        deviceId: "dev_del",
        name: "web",
        slug: "web",
        localPath: "/work/web",
      },
    ])
    .run();
}

beforeEach(seed);

describe("enqueueing what the archive must forget", () => {
  it("survives the cascade that deleting an account sets off", async () => {
    await deleteAccount(fullEnv, USER);

    // The user row is gone, and so is everything keyed to it. The instruction
    // is not, which is the entire point of the table having no foreign key.
    const user = await db(env).select().from(schema.users).where(eq(schema.users.id, USER)).get();
    expect(user).toBeUndefined();

    const pending = await pendingAuditDeletions(env);
    expect(pending).toEqual([
      expect.objectContaining({ scope: "user", targetId: USER, attempts: 0 }),
    ]);
  });

  it("names a machine's projects, since the archive cannot be asked about machines", async () => {
    const response = await call("/api/devices/dev_del/permanently", { method: "DELETE" });
    expect(response.status).toBe(200);

    const pending = await pendingAuditDeletions(env);
    expect(pending.map((row) => row.scope)).toEqual(["project", "project"]);
    expect(pending.map((row) => row.targetId).sort()).toEqual(["prj_del_a", "prj_del_b"]);
  });

  it("enqueues a deleted project", async () => {
    const response = await call("/api/projects/prj_del_a", { method: "DELETE" });
    expect(response.status).toBe(200);

    expect(await pendingAuditDeletions(env)).toEqual([
      expect.objectContaining({ scope: "project", targetId: "prj_del_a" }),
    ]);
  });

  it("does not let one account schedule the erasure of another's project", async () => {
    const response = await call("/api/projects/prj_del_a", {
      method: "DELETE",
      userId: "usr_someone_else",
    });

    expect(response.status).toBe(404);
    expect(await pendingAuditDeletions(env)).toEqual([]);
  });
});

describe("settling", () => {
  it("closes a target and takes it out of the queue", async () => {
    await deleteAccount(fullEnv, USER);
    const [pending] = await pendingAuditDeletions(env);
    if (!pending) throw new Error("nothing was enqueued");

    expect(await settleAuditDeletion(env, pending.id, { ok: true })).toBe(true);
    expect(await pendingAuditDeletions(env)).toEqual([]);
  });

  it("keeps a failed target queued, with the reason attached", async () => {
    await deleteAccount(fullEnv, USER);
    const [pending] = await pendingAuditDeletions(env);
    if (!pending) throw new Error("nothing was enqueued");

    expect(await settleAuditDeletion(env, pending.id, { ok: false, error: "catalog 503" })).toBe(
      true,
    );

    // Still owed, and now carrying both why it failed and how many runs have
    // tried. A target stuck at twenty attempts is the thing worth alerting on.
    expect(await pendingAuditDeletions(env)).toEqual([
      expect.objectContaining({ targetId: USER, attempts: 1 }),
    ]);
    const row = await db(env)
      .select({ lastError: schema.auditDeletions.lastError })
      .from(schema.auditDeletions)
      .where(eq(schema.auditDeletions.id, pending.id))
      .get();
    expect(row?.lastError).toBe("catalog 503");
  });

  it("refuses to settle a target another run already closed", async () => {
    await deleteAccount(fullEnv, USER);
    const [pending] = await pendingAuditDeletions(env);
    if (!pending) throw new Error("nothing was enqueued");

    expect(await settleAuditDeletion(env, pending.id, { ok: true })).toBe(true);
    expect(await settleAuditDeletion(env, pending.id, { ok: true })).toBe(false);
  });
});

import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pendingAuditDeletions } from "../audit-deletions.js";
import { db, schema } from "../db/client.js";
import { internal } from "./internal.js";

/**
 * The maintenance job's door.
 *
 * The gate is the point: it is the only route in the gateway that can be
 * reached without a user access token, and what it hands out is a list of
 * accounts whose history is about to be erased.
 */

const SECRET = "a-maintenance-secret-that-is-long-enough";

function call(
  path: string,
  options: { method?: string; secret?: string | null; body?: unknown; configured?: boolean } = {},
) {
  const request = new Request(`https://exeora.dev${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body), headers: { "content-type": "application/json" } }),
  });

  if (options.secret !== null) {
    request.headers.set("Authorization", `Bearer ${options.secret ?? SECRET}`);
  }

  const bindings = {
    ...env,
    ...(options.configured === false ? {} : { AUDIT_MAINTENANCE_SECRET: SECRET }),
  } as unknown as Env;

  return internal.fetch(request, bindings, createExecutionContext());
}

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.auditDeletions).run();
  await database
    .insert(schema.auditDeletions)
    .values({ id: "adl_one", scope: "user", targetId: "usr_gone" })
    .run();
});

describe("the gate", () => {
  it("hands the queue to a job holding the secret", async () => {
    const response = await call("/internal/audit-deletions");
    expect(response.status).toBe(200);

    const body = await response.json<{ items: Array<{ targetId: string }> }>();
    expect(body.items).toEqual([expect.objectContaining({ targetId: "usr_gone" })]);
  });

  it("404s a wrong secret rather than 401ing it", async () => {
    // Not 401: a 401 confirms the endpoint is real and worth attacking.
    const response = await call("/internal/audit-deletions", { secret: "wrong" });
    expect(response.status).toBe(404);
  });

  it("404s a request with no credentials at all", async () => {
    expect((await call("/internal/audit-deletions", { secret: null })).status).toBe(404);
  });

  it("404s on a deployment that never configured the secret", async () => {
    // An incomplete self-hosted deployment must not expose an unauthenticated
    // maintenance surface merely because its secret was forgotten.
    const response = await call("/internal/audit-deletions", { configured: false });
    expect(response.status).toBe(404);
  });
});

describe("the retention it serves", () => {
  it("names the windows and only the accounts outside the shortest one", async () => {
    const database = db(env);
    await database.delete(schema.users).where(eq(schema.users.id, "usr_ret_free")).run();
    await database.delete(schema.users).where(eq(schema.users.id, "usr_ret_pro")).run();
    await database
      .insert(schema.users)
      .values([
        { id: "usr_ret_free", email: "free@example.com", plan: "free" },
        { id: "usr_ret_pro", email: "pro@example.com", plan: "pro" },
      ])
      .run();

    const body = await (await call("/internal/retention")).json<{
      shortestDays: number;
      longestDays: number;
      exemptUserIds: string[];
    }>();

    expect(body.shortestDays).toBe(90);
    expect(body.longestDays).toBe(365);
    // Only the longer-plan account is named. Listing the free ones instead is
    // the version of this that stops working once there are a lot of them.
    expect(body.exemptUserIds).toContain("usr_ret_pro");
    expect(body.exemptUserIds).not.toContain("usr_ret_free");
  });
});

describe("settling a target", () => {
  async function claim() {
    const response = await call("/internal/audit-deletions/claim", { method: "POST" });
    const body = await response.json<{
      items: Array<{ id: string; leaseToken: string }>;
    }>();
    const item = body.items[0];
    if (!item) throw new Error("nothing was claimed");
    return item;
  }

  async function makeDue() {
    await db(env)
      .update(schema.auditDeletions)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.auditDeletions.id, "adl_one"))
      .run();
  }

  it("rechecks it before closing after a committed transaction", async () => {
    const first = await claim();
    const response = await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { ok: true, leaseToken: first.leaseToken },
    });

    expect(response.status).toBe(200);
    expect(await pendingAuditDeletions(env)).toHaveLength(1);

    await makeDue();
    const second = await claim();
    expect(
      (
        await call("/internal/audit-deletions/adl_one", {
          method: "POST",
          body: { ok: true, leaseToken: second.leaseToken },
        })
      ).status,
    ).toBe(200);
    expect(await pendingAuditDeletions(env)).toEqual([]);
  });

  it("keeps it queued when the job reports a failure", async () => {
    const item = await claim();
    const response = await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { ok: false, error: "catalog 503", leaseToken: item.leaseToken },
    });

    expect(response.status).toBe(200);
    expect(await pendingAuditDeletions(env)).toHaveLength(1);

    const row = await db(env)
      .select({ lastError: schema.auditDeletions.lastError })
      .from(schema.auditDeletions)
      .where(eq(schema.auditDeletions.id, "adl_one"))
      .get();
    expect(row?.lastError).toBe("catalog 503");
  });

  it("rejects a body that says nothing about the outcome", async () => {
    const response = await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { error: "oops" },
    });

    expect(response.status).toBe(400);
    expect(await pendingAuditDeletions(env)).toHaveLength(1);
  });

  it("404s a target that is already closed", async () => {
    const first = await claim();
    await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { ok: true, leaseToken: first.leaseToken },
    });
    await makeDue();
    const second = await claim();
    await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { ok: true, leaseToken: second.leaseToken },
    });
    const again = await call("/internal/audit-deletions/adl_one", {
      method: "POST",
      body: { ok: true, leaseToken: second.leaseToken },
    });

    expect(again.status).toBe(404);
  });
});

import { createExecutionContext, env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { PLANS } from "../plans.js";
import { api, pruneToolCalls, rollupUsageDaily, runNightlyHousekeeping } from "./index.js";

/**
 * Plan limits, usage rollup and per-plan audit retention.
 *
 * The free caps are finite on purpose so these tests hit the real enforcement
 * path without overriding anything. Pro is the unlimited side of the same
 * coin, used for the retention contrast.
 */

const FREE = "usr_plans_free";
const PRO = "usr_plans_pro";

function call(
  path: string,
  options: {
    method?: string;
    userId?: string;
    body?: unknown;
  } = {},
) {
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const request = new Request(`https://exeora.dev${path}`, init);
  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? FREE };
  return api.fetch(request, env, ctx);
}

async function reset() {
  const database = db(env);
  for (const id of [FREE, PRO]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }

  await database
    .insert(schema.users)
    .values([
      { id: FREE, email: "free@example.com", plan: "free" },
      { id: PRO, email: "pro@example.com", plan: "pro" },
    ])
    .run();
}

beforeEach(async () => {
  await reset();
});

function freeDeviceCap(): number {
  const max = PLANS.free.maxDevices;
  if (max === null) throw new Error("free plan must have a finite device cap for these tests");
  return max;
}

function freeProjectCap(): number {
  const max = PLANS.free.maxProjects;
  if (max === null) throw new Error("free plan must have a finite project cap for these tests");
  return max;
}

describe("device plan limits", () => {
  it("refuses a machine once the free cap is full", async () => {
    const max = freeDeviceCap();

    for (let i = 0; i < max; i += 1) {
      const response = await call("/api/devices", {
        method: "POST",
        body: { name: `machine-${i}`, platform: "linux" },
      });
      expect(response.status).toBe(201);
    }

    const blocked = await call("/api/devices", {
      method: "POST",
      body: { name: "one-too-many", platform: "linux" },
    });

    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({
      error: "plan_limit",
      limit: "devices",
      max,
      plan: "free",
    });
  });

  it("lets a revoked machine free a slot", async () => {
    const max = freeDeviceCap();

    for (let i = 0; i < max; i += 1) {
      const response = await call("/api/devices", {
        method: "POST",
        body: { name: `machine-${i}`, platform: "linux" },
      });
      expect(response.status).toBe(201);
    }

    const listed = (await (await call("/api/devices")).json()) as Array<{ id: string }>;
    const first = listed[0];
    expect(first).toBeDefined();
    const revoke = await call(`/api/devices/${first?.id}`, { method: "DELETE" });
    expect(revoke.status).toBe(200);

    const again = await call("/api/devices", {
      method: "POST",
      body: { name: "replacement", platform: "linux" },
    });
    expect(again.status).toBe(201);
  });
});

describe("project plan limits", () => {
  async function device(): Promise<string> {
    const response = await call("/api/devices", {
      method: "POST",
      body: { name: "box", platform: "linux" },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it("refuses a new project once the free cap is full", async () => {
    const deviceId = await device();
    const max = freeProjectCap();

    for (let i = 0; i < max; i += 1) {
      const response = await call("/api/projects", {
        method: "POST",
        body: {
          deviceId,
          name: `Project ${i}`,
          slug: `project-${i}`,
          localPath: `/work/p${i}`,
        },
      });
      expect(response.status).toBe(201);
    }

    const blocked = await call("/api/projects", {
      method: "POST",
      body: {
        deviceId,
        name: "Overflow",
        slug: "overflow",
        localPath: "/work/overflow",
      },
    });

    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({
      error: "plan_limit",
      limit: "projects",
      max,
      plan: "free",
    });
  });

  it("does not count re-registering an existing slug", async () => {
    const deviceId = await device();
    const max = freeProjectCap();

    for (let i = 0; i < max; i += 1) {
      const response = await call("/api/projects", {
        method: "POST",
        body: {
          deviceId,
          name: `Project ${i}`,
          slug: `project-${i}`,
          localPath: `/work/p${i}`,
        },
      });
      expect(response.status).toBe(201);
    }

    const upsert = await call("/api/projects", {
      method: "POST",
      body: {
        deviceId,
        name: "Project 0 renamed",
        slug: "project-0",
        localPath: "/work/p0-again",
      },
    });

    expect(upsert.status).toBe(200);
    expect(await upsert.json()).toMatchObject({ slug: "project-0", name: "Project 0 renamed" });
  });
});

describe("/api/me plan surface", () => {
  it("returns plan, limits and usage", async () => {
    await call("/api/devices", {
      method: "POST",
      body: { name: "box", platform: "linux" },
    });

    // Seed a month rollup row so toolCallsMonth is not always zero in the test.
    await db(env)
      .insert(schema.usageDaily)
      .values({
        userId: FREE,
        day: `${new Date().toISOString().slice(0, 7)}-02`,
        toolCalls: 7,
      })
      .run();

    const response = await call("/api/me");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      plan: string;
      limits: { maxDevices: number | null; maxProjects: number | null; retentionDays: number };
      usage: { devices: number; projects: number; toolCallsMonth: number };
      isAdmin: boolean;
      accountMcpUrl: string;
    };

    expect(body.plan).toBe("free");
    expect(body.limits).toEqual({
      maxDevices: PLANS.free.maxDevices,
      maxProjects: PLANS.free.maxProjects,
      retentionDays: PLANS.free.retentionDays,
    });
    expect(body.usage).toEqual({ devices: 1, projects: 0, toolCallsMonth: 7 });
    expect(body.accountMcpUrl).toContain("/mcp");
  });
});

async function seedProject(
  userId: string,
  ids: { deviceId: string; projectId: string; slug: string },
) {
  const database = db(env);
  await database
    .insert(schema.devices)
    .values({ id: ids.deviceId, userId, name: "box", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: ids.projectId,
      userId,
      deviceId: ids.deviceId,
      name: "api",
      slug: ids.slug,
      localPath: "/work",
    })
    .run();
}

describe("per-plan audit retention", () => {
  it("prunes free history sooner than pro", async () => {
    const database = db(env);

    await seedProject(FREE, { deviceId: "dev_free", projectId: "prj_free", slug: "api-free" });
    await seedProject(PRO, { deviceId: "dev_pro", projectId: "prj_pro", slug: "api-pro" });

    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

    await database
      .insert(schema.toolCalls)
      .values([
        {
          id: "call_free_old",
          userId: FREE,
          projectId: "prj_free",
          tool: "read_file",
          status: "ok",
          durationMs: 1,
          createdAt: hundredDaysAgo,
        },
        {
          id: "call_pro_old",
          userId: PRO,
          projectId: "prj_pro",
          tool: "read_file",
          status: "ok",
          durationMs: 1,
          createdAt: hundredDaysAgo,
        },
      ])
      .run();

    const deleted = await pruneToolCalls(env);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const freeLeft = await database
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "call_free_old"))
      .all();
    const proLeft = await database
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "call_pro_old"))
      .all();

    expect(freeLeft).toHaveLength(0);
    expect(proLeft).toHaveLength(1);
  });

  it("treats an unknown plan string like free for retention", async () => {
    const database = db(env);
    // Hand-edited values are how pro is granted today; a typo must not escape prune.
    await database.run(sql`UPDATE users SET plan = 'Pro' WHERE id = ${FREE}`);

    await seedProject(FREE, {
      deviceId: "dev_typo",
      projectId: "prj_typo",
      slug: "api-typo",
    });

    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await database
      .insert(schema.toolCalls)
      .values({
        id: "call_typo_old",
        userId: FREE,
        projectId: "prj_typo",
        tool: "read_file",
        status: "ok",
        durationMs: 1,
        createdAt: hundredDaysAgo,
      })
      .run();

    await pruneToolCalls(env);

    const left = await database
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "call_typo_old"))
      .all();
    expect(left).toHaveLength(0);
  });
});

describe("usage daily rollup", () => {
  it("aggregates past days into usage_daily", async () => {
    const database = db(env);

    await seedProject(FREE, {
      deviceId: "dev_roll",
      projectId: "prj_roll",
      slug: "api-roll",
    });

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(12, 0, 0, 0);
    const day = yesterday.toISOString().slice(0, 10);

    await database
      .insert(schema.toolCalls)
      .values([
        {
          id: "call_roll_1",
          userId: FREE,
          projectId: "prj_roll",
          tool: "read_file",
          status: "ok",
          durationMs: 1,
          createdAt: yesterday,
        },
        {
          id: "call_roll_2",
          userId: FREE,
          projectId: "prj_roll",
          tool: "grep",
          status: "ok",
          durationMs: 2,
          createdAt: yesterday,
        },
      ])
      .run();

    const written = await rollupUsageDaily(env);
    expect(written).toBeGreaterThanOrEqual(1);

    const rows = await database
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, FREE))
      .all();

    expect(rows).toEqual([expect.objectContaining({ userId: FREE, day, toolCalls: 2 })]);

    // Idempotent: a second run keeps the same total rather than stacking.
    await rollupUsageDaily(env);
    const again = await database
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, FREE))
      .all();
    expect(again).toHaveLength(1);
    expect(again[0]?.toolCalls).toBe(2);
  });

  it("does not lower a day when some audit rows are later deleted", async () => {
    const database = db(env);

    await seedProject(FREE, {
      deviceId: "dev_mono",
      projectId: "prj_mono",
      slug: "api-mono",
    });

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(12, 0, 0, 0);
    const day = yesterday.toISOString().slice(0, 10);

    await database
      .insert(schema.toolCalls)
      .values([
        {
          id: "call_mono_1",
          userId: FREE,
          projectId: "prj_mono",
          tool: "read_file",
          status: "ok",
          durationMs: 1,
          createdAt: yesterday,
        },
        {
          id: "call_mono_2",
          userId: FREE,
          projectId: "prj_mono",
          tool: "grep",
          status: "ok",
          durationMs: 2,
          createdAt: yesterday,
        },
      ])
      .run();

    await rollupUsageDaily(env);

    await database.delete(schema.toolCalls).where(eq(schema.toolCalls.id, "call_mono_2")).run();

    await rollupUsageDaily(env);

    const rows = await database
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, FREE))
      .all();

    expect(rows).toEqual([expect.objectContaining({ userId: FREE, day, toolCalls: 2 })]);
  });
});

describe("nightly housekeeping", () => {
  it("still prunes when the rollup throws", async () => {
    const database = db(env);
    await seedProject(FREE, {
      deviceId: "dev_house",
      projectId: "prj_house",
      slug: "api-house",
    });

    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await database
      .insert(schema.toolCalls)
      .values({
        id: "call_house_old",
        userId: FREE,
        projectId: "prj_house",
        tool: "read_file",
        status: "ok",
        durationMs: 1,
        createdAt: hundredDaysAgo,
      })
      .run();

    await runNightlyHousekeeping(env, {
      rollup: async () => {
        throw new Error("d1 timeout");
      },
    });

    const left = await database
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "call_house_old"))
      .all();
    expect(left).toHaveLength(0);
  });
});

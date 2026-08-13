import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { PLANS } from "../plans.js";
import { api } from "./index.js";

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
  (ctx as { props?: { userId: string; scopes: string[] } }).props = {
    userId: options.userId ?? FREE,
    scopes: ["dashboard:manage"],
  };
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

  it("refuses to register or move a project onto a revoked machine", async () => {
    const deviceId = await device();
    expect((await call(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(200);

    const response = await call("/api/projects", {
      method: "POST",
      body: {
        deviceId,
        name: "Revoked target",
        slug: "revoked-target",
        localPath: "/work/revoked",
      },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "device_revoked" });
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

async function _seedProject(
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

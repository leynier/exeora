import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * Administration panel.
 *
 * The gate is the point: an ordinary account must not learn that the surface
 * exists, and an admin must see every account's counts without being able to
 * act on their own from this door.
 */

const ADMIN = "usr_admin_test";
const ADMIN_EMAIL = "admin@example.com";
const USER = "usr_admin_subject";
const USER_EMAIL = "subject@example.com";
const OTHER = "usr_admin_other";

function call(path: string, options: { method?: string; userId?: string } = {}) {
  const request = new Request(`https://exeora.dev${path}`, { method: options.method ?? "GET" });
  const ctx = createExecutionContext();
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? ADMIN };

  return api.fetch(request, env, ctx);
}

/** Today as a UTC day, which is how `usage_daily` is keyed. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function seed() {
  const database = db(env);

  for (const id of [ADMIN, USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database.delete(schema.adminUsers).where(eq(schema.adminUsers.email, ADMIN_EMAIL)).run();
  await database.delete(schema.adminUsers).where(eq(schema.adminUsers.email, USER_EMAIL)).run();

  await database
    .insert(schema.users)
    .values([
      { id: ADMIN, email: ADMIN_EMAIL, name: "Admin" },
      { id: USER, email: USER_EMAIL, name: "Subject" },
      { id: OTHER, email: "other@example.com" },
    ])
    .run();

  await database.insert(schema.adminUsers).values({ email: ADMIN_EMAIL }).run();

  await database
    .insert(schema.devices)
    .values([
      {
        id: "dev_subject_online",
        userId: USER,
        name: "laptop",
        platform: "linux",
        lastSeenAt: new Date(),
      },
      {
        id: "dev_subject_offline",
        userId: USER,
        name: "old-box",
        platform: "darwin",
        lastSeenAt: new Date(Date.now() - 30 * 60_000),
      },
      {
        // Inside the checkpoint window, but the relay watched it go. The panel
        // has to believe the close rather than the window.
        id: "dev_subject_left",
        userId: USER,
        name: "desktop",
        platform: "linux",
        lastSeenAt: new Date(),
        disconnectedAt: new Date(),
      },
      {
        id: "dev_other",
        userId: OTHER,
        name: "other-machine",
        platform: "linux",
      },
    ])
    .run();

  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_subject",
        userId: USER,
        deviceId: "dev_subject_online",
        name: "App",
        slug: "app",
        localPath: "/home/subject/app",
      },
      {
        id: "prj_other",
        userId: OTHER,
        deviceId: "dev_other",
        name: "Other",
        slug: "other",
        localPath: "/home/other/app",
      },
    ])
    .run();

  await database
    .insert(schema.projectClients)
    .values({
      id: "pcl_subject",
      userId: USER,
      projectId: "prj_subject",
      endpoint: "project",
      clientId: "client_claude",
      clientName: "Claude",
      authorizedAt: new Date(),
    })
    .run();

  // `usage_daily`, because that is what the panel reads now: the per-call table
  // is gone and the archive is not something a test can seed.
  await database
    .insert(schema.usageDaily)
    .values([
      { userId: USER, day: today(), toolCalls: 2, errors: 1, lastActivityAt: new Date() },
      { userId: OTHER, day: today(), toolCalls: 1, errors: 0, lastActivityAt: new Date() },
    ])
    .run();
}

beforeEach(seed);

describe("admin gate", () => {
  it("returns isAdmin on /api/me for allow-listed emails only", async () => {
    const adminMe = await (await call("/api/me")).json<{ isAdmin: boolean }>();
    const userMe = await (await call("/api/me", { userId: USER })).json<{ isAdmin: boolean }>();

    expect(adminMe.isAdmin).toBe(true);
    expect(userMe.isAdmin).toBe(false);
  });

  it("answers 404 to a non-admin on every admin route", async () => {
    for (const path of ["/api/admin/overview", "/api/admin/users", `/api/admin/users/${USER}`]) {
      const response = await call(path, { userId: USER });
      expect(response.status, path).toBe(404);
    }

    const revoke = await call(`/api/admin/users/${OTHER}/devices/dev_other`, {
      method: "DELETE",
      userId: USER,
    });
    expect(revoke.status).toBe(404);

    const remove = await call(`/api/admin/users/${OTHER}`, {
      method: "DELETE",
      userId: USER,
    });
    expect(remove.status).toBe(404);
  });
});

describe("admin reads", () => {
  it("lists every user with per-user counts", async () => {
    const response = await call("/api/admin/users");
    expect(response.status).toBe(200);

    const users = (await response.json()) as Array<{
      id: string;
      devices: number;
      devicesOnline: number;
      projects: number;
      clients: number;
      toolCalls: number;
    }>;

    const subject = users.find((row) => row.id === USER);
    expect(subject).toMatchObject({
      devices: 3,
      devicesOnline: 1,
      projects: 1,
      clients: 1,
      toolCalls: 2,
    });

    expect(users.some((row) => row.id === OTHER)).toBe(true);
    expect(users.some((row) => row.id === ADMIN)).toBe(true);
  });

  it("returns global totals on the overview", async () => {
    const response = await call("/api/admin/overview");
    expect(response.status).toBe(200);

    const overview = (await response.json()) as {
      users: number;
      devices: number;
      devicesOnline: number;
      projects: number;
      clients: number;
      toolCalls: number;
    };

    expect(overview.users).toBeGreaterThanOrEqual(3);
    expect(overview.devices).toBeGreaterThanOrEqual(3);
    expect(overview.devicesOnline).toBeGreaterThanOrEqual(1);
    expect(overview.projects).toBeGreaterThanOrEqual(2);
    expect(overview.clients).toBeGreaterThanOrEqual(1);
    expect(overview.toolCalls).toBeGreaterThanOrEqual(3);
  });

  it("returns a user detail with machines, projects and clients", async () => {
    const response = await call(`/api/admin/users/${USER}`);
    expect(response.status).toBe(200);

    const detail = (await response.json()) as {
      email: string;
      devicesOnline: number;
      machineList: Array<{ id: string; online: boolean }>;
      projectList: Array<{ id: string }>;
      clientList: Array<{ id: string }>;
      recentCalls: Array<{ id: string }>;
    };

    expect(detail.email).toBe(USER_EMAIL);
    expect(detail.machineList.map((row) => row.id).sort()).toEqual([
      "dev_subject_left",
      "dev_subject_offline",
      "dev_subject_online",
    ]);
    expect(detail.devicesOnline).toBe(1);
    expect(Object.fromEntries(detail.machineList.map((row) => [row.id, row.online]))).toMatchObject(
      {
        dev_subject_online: true,
        dev_subject_left: false,
        dev_subject_offline: false,
      },
    );
    expect(detail.projectList.map((row) => row.id)).toEqual(["prj_subject"]);
    expect(detail.clientList.map((row) => row.id)).toEqual(["pcl_subject"]);
    // Recent calls come from the archive, which no test can seed and which the
    // pool's blocked outbound makes unreachable. Empty rather than a failed
    // page is the behaviour that matters: the rest of this view is D1 and an
    // admin should still see it when one R2 SQL query does not answer.
    expect(detail.recentCalls).toEqual([]);
  });
});

describe("admin actions", () => {
  it("revokes another user's machine", async () => {
    const response = await call(`/api/admin/users/${USER}/devices/dev_subject_online`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    const device = await db(env)
      .select({ revokedAt: schema.devices.revokedAt })
      .from(schema.devices)
      .where(eq(schema.devices.id, "dev_subject_online"))
      .get();

    expect(device?.revokedAt).not.toBeNull();
  });

  it("returns 404 when the machine is not that user's", async () => {
    const response = await call(`/api/admin/users/${USER}/devices/dev_other`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });

  it("revokes another user's client", async () => {
    const response = await call(`/api/admin/users/${USER}/clients/pcl_subject`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    const client = await db(env)
      .select({ revokedAt: schema.projectClients.revokedAt })
      .from(schema.projectClients)
      .where(eq(schema.projectClients.id, "pcl_subject"))
      .get();

    expect(client?.revokedAt).not.toBeNull();
  });

  it("deletes another user and cascades their rows", async () => {
    const response = await call(`/api/admin/users/${USER}`, { method: "DELETE" });
    expect(response.status).toBe(200);

    const user = await db(env)
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, USER))
      .get();
    expect(user).toBeUndefined();

    const devices = await db(env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.userId, USER))
      .all();
    expect(devices).toEqual([]);

    const projects = await db(env)
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.userId, USER))
      .all();
    expect(projects).toEqual([]);

    // Neighbour untouched.
    const other = await db(env)
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, OTHER))
      .get();
    expect(other?.id).toBe(OTHER);
  });

  it("refuses to let an admin act on themselves through the admin door", async () => {
    const remove = await call(`/api/admin/users/${ADMIN}`, { method: "DELETE" });
    expect(remove.status).toBe(400);
    expect(await remove.json()).toEqual({ error: "use_own_settings" });

    await db(env)
      .insert(schema.devices)
      .values({
        id: "dev_admin_self",
        userId: ADMIN,
        name: "admin-box",
        platform: "linux",
      })
      .run();

    const revoke = await call(`/api/admin/users/${ADMIN}/devices/dev_admin_self`, {
      method: "DELETE",
    });
    expect(revoke.status).toBe(400);
  });
});

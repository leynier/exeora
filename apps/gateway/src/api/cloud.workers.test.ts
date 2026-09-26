import { createExecutionContext, env, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * The Cloud routes: who may use them, what creating a project and a workspace
 * leaves in the database, and the caps. Provisioning itself is the object's
 * business and is tested there; here the object only receives its input.
 */

const ADMIN = "usr_cloud_api_admin";
const ENABLED = "usr_cloud_api_enabled";
const PLAIN = "usr_cloud_api_plain";

function call(
  path: string,
  options: { method?: string; body?: unknown; userId?: string; env?: typeof env } = {},
) {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[] } }).props = {
    userId: options.userId ?? ENABLED,
    scopes: ["dashboard:manage"],
  };
  return api.fetch(
    new Request(`https://exeora.dev${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      ...(options.body
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }
        : {}),
    }),
    options.env ?? env,
    context,
  );
}

const project = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: slug,
  slug,
  repoUrl: "https://github.com/leynier/exeora.git",
  ...extra,
});

beforeEach(async () => {
  const database = db(env);
  for (const id of [ADMIN, ENABLED, PLAIN]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: ADMIN, email: "cloud-admin@example.com" },
      { id: ENABLED, email: "cloud-enabled@example.com", cloudEnabled: true },
      { id: PLAIN, email: "cloud-plain@example.com" },
    ])
    .run();
  await database
    .insert(schema.adminUsers)
    .values({ email: "cloud-admin@example.com" })
    .onConflictDoNothing()
    .run();
});

describe("Exeora Cloud routes", () => {
  it("lets anyone see their machines, and only enabled accounts make them", async () => {
    // An account switched off still sees, and could remove, what it has.
    const plain = await call("/api/cloud/projects", { userId: PLAIN });
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({ projects: [] });
    const refused = await call("/api/cloud/projects", { body: project("no"), userId: PLAIN });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "cloud_disabled" });

    const admin = await call("/api/cloud/projects", { userId: ADMIN });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ projects: [] });

    const enabled = await call("/api/cloud/projects");
    expect(enabled.status).toBe(200);

    const me = await call("/api/me");
    expect(await me.json()).toMatchObject({ cloudEnabled: true });
    const plainMe = await call("/api/me", { userId: PLAIN });
    expect(await plainMe.json()).toMatchObject({ cloudEnabled: false });
  });

  it("creates the rows a project needs and hands the machine to provisioning", async () => {
    const response = await call("/api/cloud/projects", {
      body: project("demo", { token: "ghp_secret", defaultBranch: "develop" }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { projectId: string; deviceId: string; status: string };
    expect(body.status).toBe("creating");

    const database = db(env);
    const device = await database
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, body.deviceId))
      .get();
    expect(device).toMatchObject({ kind: "cloud", userId: ENABLED, name: "demo (main)" });
    const row = await database
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, body.projectId))
      .get();
    expect(row).toMatchObject({
      deviceId: body.deviceId,
      slug: "demo",
      localPath: "/home/sprite/workspace",
    });
    const cloudProject = await database
      .select()
      .from(schema.cloudProjects)
      .where(eq(schema.cloudProjects.projectId, body.projectId))
      .get();
    expect(cloudProject).toMatchObject({
      defaultBranch: "develop",
      credentialUsername: "x-access-token",
    });
    expect(cloudProject?.credentialCiphertext?.startsWith("v1.")).toBe(true);
    expect(cloudProject?.credentialCiphertext).not.toContain("ghp_secret");
    const machine = await database
      .select()
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, body.deviceId))
      .get();
    expect(machine).toMatchObject({
      projectId: body.projectId,
      workspaceId: null,
      status: "creating",
    });
    expect(machine?.spriteName).toBe(`exeora-${body.deviceId.slice(4)}`);
    expect(machine?.tokenHash).toHaveLength(64);

    const listed = (await (await call("/api/cloud/projects")).json()) as {
      projects: Array<{
        slug: string;
        hasCredential: boolean;
        machines: Array<{ workspaceSlug: string }>;
      }>;
    };
    expect(listed.projects).toMatchObject([
      { slug: "demo", hasCredential: true, machines: [{ workspaceSlug: "main" }] },
    ]);
    expect(await machineStatus(body.deviceId)).toMatchObject({ phase: "create" });

    // The slot is taken: a laptop cannot register a project onto this machine.
    const onto = await call("/api/projects", {
      body: { deviceId: body.deviceId, name: "x", slug: "x", localPath: "/x" },
    });
    expect(onto.status).toBe(400);
    expect(await onto.json()).toEqual({ error: "cloud_device" });

    const again = await call("/api/cloud/projects", { body: project("demo") });
    expect(again.status).toBe(409);

    // Nor can a laptop take the slug over and point the project at itself.
    await db(env)
      .insert(schema.devices)
      .values({ id: "dev_cloud_api_laptop", userId: ENABLED, name: "laptop", platform: "linux" })
      .onConflictDoNothing()
      .run();
    const hijack = await call("/api/projects", {
      body: { deviceId: "dev_cloud_api_laptop", name: "demo", slug: "demo", localPath: "/w" },
    });
    expect(hijack.status).toBe(409);
    expect(await hijack.json()).toEqual({ error: "cloud_project" });
    const still = await database
      .select({ deviceId: schema.projects.deviceId })
      .from(schema.projects)
      .where(eq(schema.projects.id, body.projectId))
      .get();
    expect(still).toEqual({ deviceId: body.deviceId });
  });

  it("adds a workspace as a machine of its own and refuses the default branch", async () => {
    const created = (await (await call("/api/cloud/projects", { body: project("ws") })).json()) as {
      projectId: string;
    };

    const response = await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
      body: { branch: "feature/Login-Form" },
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { workspaceId: string; deviceId: string; slug: string };
    expect(body.slug).toBe("feature-login-form");
    const workspace = await db(env)
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, body.workspaceId))
      .get();
    expect(workspace).toMatchObject({
      projectId: created.projectId,
      deviceId: body.deviceId,
      branch: "feature/Login-Form",
      managed: true,
    });
    const machine = await db(env)
      .select()
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, body.deviceId))
      .get();
    expect(machine).toMatchObject({ workspaceId: body.workspaceId, status: "creating" });

    // Destroyed under the project the URL names, or not at all.
    const elsewhere = await call(`/api/cloud/projects/prj_other/workspaces/${body.workspaceId}`, {
      method: "DELETE",
    });
    expect(elsewhere.status).toBe(404);
    expect(await statuses(created.projectId)).toMatchObject({ [body.deviceId]: "creating" });

    const same = await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
      body: { branch: "main" },
    });
    expect(same.status).toBe(422);
    expect(await same.json()).toMatchObject({ error: "invalid_branch" });
    const bad = await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
      body: { branch: "bad..branch" },
    });
    expect(bad.status).toBe(422);
  });

  it("asks for the token again once the gateway's key has changed", async () => {
    const created = (await (
      await call("/api/cloud/projects", { body: project("rekeyed", { token: "ghp_old" }) })
    ).json()) as { projectId: string };
    const rotated = {
      ...env,
      CLOUD_CREDENTIALS_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    } as typeof env;
    const response = await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
      body: { branch: "feature/after-rotation" },
      env: rotated,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "credentials_unavailable" });
  });

  it("refuses a repository address that carries a token", async () => {
    const response = await call("/api/cloud/projects", {
      body: project("leaky", { repoUrl: "https://x-access-token:ghp_leak@github.com/o/r.git" }),
    });
    expect(response.status).toBe(400);
    const leftover = await db(env)
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.slug, "leaky"))
      .get();
    expect(leftover).toBeUndefined();
  });

  it("lets one of two retries win", async () => {
    const created = (await (
      await call("/api/cloud/projects", { body: project("racing") })
    ).json()) as { deviceId: string };
    await db(env)
      .update(schema.cloudMachines)
      .set({ status: "error", error: "boom" })
      .where(eq(schema.cloudMachines.deviceId, created.deviceId))
      .run();
    const [first, second] = await Promise.all([
      call(`/api/cloud/machines/${created.deviceId}/retry`, { method: "POST" }),
      call(`/api/cloud/machines/${created.deviceId}/retry`, { method: "POST" }),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
  });

  it("refuses to build a machine with a CLI release that has no cloud mode", async () => {
    // The var is typed as the literal wrangler.jsonc announces today.
    const old = { ...env, LATEST_CLI_VERSION: "0.16.0" } as typeof env;
    const response = await call("/api/cloud/projects", { body: project("early"), env: old });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "cli_unsupported" });
    const leftover = await db(env)
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.slug, "early"))
      .get();
    expect(leftover).toBeUndefined();
  });

  it("caps the machines an account may have", async () => {
    expect((await call("/api/cloud/projects", { body: project("one") })).status).toBe(202);
    expect((await call("/api/cloud/projects", { body: project("two") })).status).toBe(202);
    const third = await call("/api/cloud/projects", { body: project("three") });
    expect(third.status).toBe(403);
    expect(await third.json()).toEqual({
      error: "plan_limit",
      limit: "cloudMachines",
      max: 2,
      plan: "free",
    });
    // Nothing of the refused project was left behind.
    const leftover = await db(env)
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.slug, "three"))
      .get();
    expect(leftover).toBeUndefined();
  });

  it("marks every machine of a deleted project as going away", async () => {
    const created = (await (
      await call("/api/cloud/projects", { body: project("gone") })
    ).json()) as { projectId: string; deviceId: string };
    const before = (await (await call("/api/me")).json()) as { usage: { cloudMachines: number } };
    expect(before.usage.cloudMachines).toBe(1);
    const response = await call(`/api/cloud/projects/${created.projectId}`, { method: "DELETE" });
    expect(response.status).toBe(202);
    const machine = await db(env)
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, created.deviceId))
      .get();
    expect(machine).toEqual({ status: "destroying" });
    expect(await machineStatus(created.deviceId)).toMatchObject({ phase: "destroy" });
    // The slot is free as soon as the removal is accepted, not when it is done.
    const after = (await (await call("/api/me")).json()) as { usage: { cloudMachines: number } };
    expect(after.usage.cloudMachines).toBe(0);
  });

  it("takes no new workspace once the project's removal is accepted", async () => {
    const created = (await (
      await call("/api/cloud/projects", { body: project("closing") })
    ).json()) as { projectId: string };
    expect(
      (await call(`/api/cloud/projects/${created.projectId}`, { method: "DELETE" })).status,
    ).toBe(202);
    const late = await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
      body: { branch: "feature/late" },
    });
    expect(late.status).toBe(404);
    // Nothing of it was left behind: no device, no workspace row.
    const devices = await db(env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.userId, ENABLED))
      .all();
    expect(devices).toHaveLength(1);
    const workspaces = await db(env)
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.projectId, created.projectId))
      .all();
    expect(workspaces).toEqual([]);
  });

  it("takes the whole project down when its main machine is revoked, from either panel", async () => {
    const created = (await (
      await call("/api/cloud/projects", { body: project("revoked") })
    ).json()) as { projectId: string; deviceId: string };
    const workspace = (await (
      await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
        body: { branch: "feature/a" },
      })
    ).json()) as { deviceId: string };

    // The owner revokes the workspace machine: only that one goes.
    const own = await call(`/api/devices/${workspace.deviceId}`, { method: "DELETE" });
    expect(own.status).toBe(200);
    expect(await statuses(created.projectId)).toEqual({
      [created.deviceId]: "creating",
      [workspace.deviceId]: "destroying",
    });

    // An administrator revokes the main machine: the project and every
    // machine of it go, none is left to be orphaned by the cascade.
    const admin = await call(`/api/admin/users/${ENABLED}/devices/${created.deviceId}`, {
      method: "DELETE",
      userId: ADMIN,
    });
    expect(admin.status).toBe(200);
    expect(await statuses(created.projectId)).toEqual({
      [created.deviceId]: "destroying",
      [workspace.deviceId]: "destroying",
    });
    expect(await machineStatus(created.deviceId)).toMatchObject({ phase: "destroy" });
  });

  it("starts a new branch from the project's default branch, and keeps the base on a retry", async () => {
    // Three machines here, one over the free cap.
    await db(env).update(schema.users).set({ plan: "pro" }).where(eq(schema.users.id, ENABLED));
    const created = (await (
      await call("/api/cloud/projects", { body: project("base", { defaultBranch: "develop" }) })
    ).json()) as { projectId: string };
    const implicit = (await (
      await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
        body: { branch: "feature/implicit" },
      })
    ).json()) as { deviceId: string };
    expect(await requestedBase(implicit.deviceId)).toBe("develop");

    const explicit = (await (
      await call(`/api/cloud/projects/${created.projectId}/workspaces`, {
        body: { branch: "feature/explicit", from: "release/1" },
      })
    ).json()) as { deviceId: string };
    expect(await requestedBase(explicit.deviceId)).toBe("release/1");

    // The first hand-off to the machine's object failed before it stored a
    // thing: the base still comes back, from the row.
    await db(env)
      .update(schema.cloudMachines)
      .set({ status: "error", error: "boom" })
      .where(eq(schema.cloudMachines.deviceId, explicit.deviceId))
      .run();
    await runInDurableObject(env.CLOUD_MACHINE.getByName(explicit.deviceId), (_instance, state) =>
      state.storage.deleteAll(),
    );
    const retried = await call(`/api/cloud/machines/${explicit.deviceId}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(202);
    expect(await requestedBase(explicit.deviceId)).toBe("release/1");
  });

  it("lets an administrator switch an account on, and not themselves", async () => {
    const self = await call(`/api/admin/users/${ADMIN}/cloud`, {
      method: "PUT",
      body: { enabled: true },
      userId: ADMIN,
    });
    expect(self.status).toBe(400);

    const on = await call(`/api/admin/users/${PLAIN}/cloud`, {
      method: "PUT",
      body: { enabled: true },
      userId: ADMIN,
    });
    expect(on.status).toBe(200);
    expect((await call("/api/cloud/projects", { userId: PLAIN })).status).toBe(200);

    const listed = (await (await call("/api/admin/users", { userId: ADMIN })).json()) as Array<{
      id: string;
      cloudEnabled: boolean;
    }>;
    expect(listed.find((user) => user.id === PLAIN)?.cloudEnabled).toBe(true);
  });
});

async function machineStatus(deviceId: string) {
  return env.CLOUD_MACHINE.getByName(deviceId).status();
}

async function requestedBase(deviceId: string) {
  return runInDurableObject(env.CLOUD_MACHINE.getByName(deviceId), (_instance, state) =>
    state.storage
      .get<{ createBranchFrom?: string }>("input")
      .then((input) => input?.createBranchFrom ?? null),
  );
}

async function statuses(projectId: string) {
  const rows = await db(env)
    .select({ deviceId: schema.cloudMachines.deviceId, status: schema.cloudMachines.status })
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.projectId, projectId))
    .all();
  return Object.fromEntries(rows.map((row) => [row.deviceId, row.status]));
}

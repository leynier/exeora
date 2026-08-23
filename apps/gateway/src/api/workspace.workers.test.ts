import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

const OWNER = "usr_workspace_owner";
const OTHER = "usr_workspace_other";
const DEVICE = "dev_workspace";
const PROJECT = "prj_workspace";

function call(path: string, userId = OWNER) {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[] } }).props = {
    userId,
    scopes: ["dashboard:manage"],
  };
  return api.fetch(new Request(`https://exeora.dev${path}`), env, context);
}

beforeEach(async () => {
  const database = db(env);
  for (const userId of [OWNER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, userId)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: OWNER, email: "workspace-owner@example.com" },
      { id: OTHER, email: "workspace-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE, userId: OWNER, name: "workspace machine", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: OWNER,
      deviceId: DEVICE,
      name: "workspace",
      slug: "workspace",
      localPath: "/work/workspace",
    })
    .run();
});

describe("workspace ownership and availability", () => {
  it("reports capabilities without exposing the local executor to another owner", async () => {
    const owner = await call(`/api/projects/${PROJECT}/workspace/capabilities`);
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({
      online: false,
      sourceControl: false,
      terminal: false,
      worktreeRouting: false,
    });

    const other = await call(`/api/projects/${PROJECT}/workspace/capabilities`, OTHER);
    expect(other.status).toBe(404);
  });

  it("fails a status read immediately while the owner's machine is offline", async () => {
    const response = await call(`/api/projects/${PROJECT}/workspace/status`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });
  });

  it("never issues another owner a terminal ticket", async () => {
    const response = await call(`/api/projects/${PROJECT}/terminal-ticket`, OTHER);
    expect(response.status).toBe(404);
  });

  it("lists no terminals while none are open", async () => {
    const response = await call("/api/terminals");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    const other = await call("/api/terminals", OTHER);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ items: [] });
  });

  it("resolves only worktrees that belong to the owner's project", async () => {
    await db(env)
      .insert(schema.worktrees)
      .values({
        id: "wtr_workspace",
        projectId: PROJECT,
        slug: "feature",
        name: "Feature",
        branch: "feature",
        localPath: "/work/feature",
        managed: true,
      })
      .run();

    const known = await call(
      `/api/projects/${PROJECT}/workspace/capabilities?worktree=wtr_workspace`,
    );
    expect(known.status).toBe(200);
    expect(await known.json()).toMatchObject({ online: false, worktreeRouting: false });

    const missing = await call(`/api/projects/${PROJECT}/workspace/status?worktree=missing`);
    expect(missing.status).toBe(404);
    const hidden = await call(
      `/api/projects/${PROJECT}/workspace/capabilities?worktree=feature`,
      OTHER,
    );
    expect(hidden.status).toBe(404);
  });
});

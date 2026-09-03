import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

const USER = "usr_workspaces";
const OTHER = "usr_workspaces_other";

function call(path: string, userId = USER, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  (ctx as { props?: { userId: string; scopes: string[] } }).props = {
    userId,
    scopes: ["dashboard:manage"],
  };
  return api.fetch(
    new Request(`https://exeora.dev${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    env,
    ctx,
  );
}

beforeEach(async () => {
  for (const id of [USER, OTHER]) {
    await db(env).delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await db(env)
    .insert(schema.users)
    .values([
      { id: USER, email: "workspaces@example.com" },
      { id: OTHER, email: "other-workspaces@example.com" },
    ])
    .run();
  await db(env)
    .insert(schema.devices)
    .values({ id: "dev_workspaces", userId: USER, name: "box", platform: "linux" })
    .run();
  await db(env)
    .insert(schema.projects)
    .values({
      id: "prj_workspaces",
      userId: USER,
      deviceId: "dev_workspaces",
      name: "Repo",
      slug: "repo",
      localPath: "/work/repo",
    })
    .run();
});

describe("workspace inventory", () => {
  it("upserts, lists and idempotently removes a project workspace", async () => {
    const path = "/api/projects/prj_workspaces/workspaces/wsp_123";
    const body = {
      slug: "feature-one",
      name: "Feature one",
      branch: "feature/one",
      localPath: "/work/workspaces/feature-one",
      managed: true,
    };
    expect((await call(path, USER, "PUT", body)).status).toBe(200);

    const listed = (await (await call("/api/projects/prj_workspaces/workspaces")).json()) as Array<{
      id: string;
      slug: string;
    }>;
    expect(listed).toMatchObject([{ id: "wsp_123", slug: "feature-one" }]);

    expect((await call(path, USER, "DELETE")).status).toBe(200);
    expect((await call(path, USER, "DELETE")).status).toBe(200);
  });

  it("does not expose or mutate another account's project", async () => {
    const collection = "/api/projects/prj_workspaces/workspaces";
    expect((await call(collection, OTHER)).status).toBe(404);
    expect(
      (
        await call(`${collection}/wsp_123`, OTHER, "PUT", {
          slug: "stolen",
          name: "Stolen",
          localPath: "/tmp/stolen",
          managed: false,
        })
      ).status,
    ).toBe(404);
  });

  it("rejects a workspace id that is not an id prefix", async () => {
    const response = await call(
      "/api/projects/prj_workspaces/workspaces/feature-one",
      USER,
      "PUT",
      {
        slug: "feature-one",
        name: "Feature one",
        localPath: "/work/workspaces/feature-one",
        managed: true,
      },
    );
    expect(response.status).toBe(400);
  });

  it("reserves main for the primary project root", async () => {
    const response = await call("/api/projects/prj_workspaces/workspaces/wsp_main", USER, "PUT", {
      slug: "main",
      name: "Main",
      localPath: "/work/repo",
      managed: false,
    });
    expect(response.status).toBe(400);
  });
});

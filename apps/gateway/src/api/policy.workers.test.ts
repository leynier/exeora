import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * Setting a project's command policy.
 *
 * The endpoint is thin, so what is worth pinning down is what it refuses: a
 * body the executor would not understand, and a project belonging to somebody
 * else. Everything the policy then means is decided by `@exeora/protocol`,
 * whose own tests cover it.
 */

const USER = "usr_policy_test";
const OTHER = "usr_policy_other";

function call(path: string, options: { method?: string; body?: unknown; userId?: string } = {}) {
  const request = new Request(`https://exeora.dev${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }),
  });
  const ctx = createExecutionContext();
  // What the OAuth provider attaches once it has validated the bearer token.
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? USER };

  return api.fetch(request, env, ctx);
}

const stored = async () =>
  (
    await db(env)
      .select({ commandPolicy: schema.projects.commandPolicy })
      .from(schema.projects)
      .where(eq(schema.projects.id, "prj_p"))
      .get()
  )?.commandPolicy ?? null;

beforeEach(async () => {
  const database = db(env);

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
    .values({ id: "dev_p", userId: USER, name: "minipc", platform: "linux" })
    .run();

  await database
    .insert(schema.projects)
    .values({
      id: "prj_p",
      userId: USER,
      deviceId: "dev_p",
      name: "api",
      slug: "api-p",
      localPath: "/work/api",
    })
    .run();
});

describe("setting a policy", () => {
  it("stores it and hands it back", async () => {
    const policy = { mode: "allow_list", allow: ["npm", "git"], shell: false, approve: false };

    const response = await call("/api/projects/prj_p/policy", { method: "PUT", body: policy });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(policy);
    expect(JSON.parse((await stored()) ?? "null")).toEqual(policy);
  });

  it("shows up on the project", async () => {
    await call("/api/projects/prj_p/policy", {
      method: "PUT",
      body: { mode: "read_only", allow: [], shell: false },
    });

    const projects = (await (await call("/api/projects")).json()) as Array<{
      id: string;
      policy: { mode: string };
    }>;

    expect(projects.find((row) => row.id === "prj_p")?.policy.mode).toBe("read_only");
  });

  it("reads as allow_all until one is set", async () => {
    const projects = (await (await call("/api/projects")).json()) as Array<{
      id: string;
      policy: { mode: string };
    }>;

    expect(projects.find((row) => row.id === "prj_p")?.policy.mode).toBe("allow_all");
  });

  it("fills in the fields a caller left out", async () => {
    const response = await call("/api/projects/prj_p/policy", {
      method: "PUT",
      body: { mode: "allow_list" },
    });

    expect(await response.json()).toEqual({
      mode: "allow_list",
      allow: [],
      shell: false,
      approve: false,
    });
  });
});

describe("what it refuses", () => {
  it("rejects a mode the executor would not understand", async () => {
    const response = await call("/api/projects/prj_p/policy", {
      method: "PUT",
      body: { mode: "sometimes", allow: [], shell: false },
    });

    expect(response.status).toBe(400);
    // Nothing stored, so a rejected body cannot leave a project half configured.
    expect(await stored()).toBeNull();
  });

  it("rejects an allow list that is not a list of strings", async () => {
    const response = await call("/api/projects/prj_p/policy", {
      method: "PUT",
      body: { mode: "allow_list", allow: [{ command: "npm" }], shell: false },
    });

    expect(response.status).toBe(400);
  });

  it("does not let one account set another's policy", async () => {
    const response = await call("/api/projects/prj_p/policy", {
      method: "PUT",
      userId: OTHER,
      body: { mode: "allow_all", allow: [], shell: false },
    });

    expect(response.status).toBe(404);
    expect(await stored()).toBeNull();
  });

  it("404s on a project that does not exist", async () => {
    const response = await call("/api/projects/prj_nope/policy", {
      method: "PUT",
      body: { mode: "allow_all", allow: [], shell: false },
    });

    expect(response.status).toBe(404);
  });
});

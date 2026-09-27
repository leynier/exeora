import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { grantNewProject, rememberAccountAuthorization } from "./account-access.js";
import { call, provider, seed, USER } from "./api/clients-fixtures.js";
import { accountProjects } from "./client-targets.js";
import { db, schema } from "./db/client.js";
import { accountConsentPage } from "./oauth/pages.js";

/**
 * "All of my projects, including the ones I add later."
 *
 * The rows stay the authority, so every case here ends by reading them, or by
 * asking what a call on the account URL would reach.
 */
describe("a client given every project", () => {
  const CLAUDE = { userId: USER, clientId: "client_claude" };
  const CHATGPT = { userId: USER, clientId: "client_chatgpt" };

  beforeEach(async () => {
    await seed({ revoked: false });
    await db(env).delete(schema.accountClients).run();
  });

  const authorize = (
    client: { userId: string; clientId: string },
    projectIds: string[],
    allProjects: boolean,
  ) =>
    rememberAccountAuthorization(env, {
      ...client,
      projectIds,
      allProjects,
      clientName: client.clientId,
      clientUri: undefined,
    });

  const reached = async (client: { userId: string; clientId: string }) =>
    (await accountProjects(env, client)).map((project) => project.id).sort();

  const flag = async (client: { userId: string; clientId: string }) =>
    (
      await db(env)
        .select()
        .from(schema.accountClients)
        .where(
          and(
            eq(schema.accountClients.userId, client.userId),
            eq(schema.accountClients.clientId, client.clientId),
          ),
        )
        .get()
    )?.allProjects;

  async function addProject(id: string) {
    await db(env)
      .insert(schema.projects)
      .values({
        id,
        userId: USER,
        deviceId: "dev_c",
        name: id,
        slug: id.replace("_", "-"),
        localPath: `/work/${id}`,
      })
      .run();
  }

  it("reaches a project created after it was authorized", async () => {
    await authorize(CLAUDE, ["prj_one", "prj_two"], true);
    await authorize(CHATGPT, ["prj_one"], false);

    await addProject("prj_new");
    await grantNewProject(env, { userId: USER, projectId: "prj_new" });

    expect(await reached(CLAUDE)).toEqual(["prj_new", "prj_one", "prj_two"]);
    // The one that chose its projects was not asked about this one.
    expect(await reached(CHATGPT)).toEqual(["prj_one"]);
  });

  it("gives a new project to the clients named while creating it", async () => {
    await authorize(CHATGPT, ["prj_one"], false);

    await addProject("prj_new");
    await grantNewProject(env, {
      userId: USER,
      projectId: "prj_new",
      clientIds: ["client_chatgpt", "client_nobody_authorized"],
    });

    expect(await reached(CHATGPT)).toEqual(["prj_new", "prj_one"]);
    expect(await reached({ userId: USER, clientId: "client_nobody_authorized" })).toEqual([]);
  });

  it("does not revive a client that was cut off by naming it", async () => {
    await authorize(CHATGPT, ["prj_one"], false);
    const { bindings } = provider([]);
    await call("/api/account-clients/projects", {
      method: "PUT",
      bindings,
      body: { clientId: "client_chatgpt", projectIds: [] },
    });

    await addProject("prj_new");
    await grantNewProject(env, {
      userId: USER,
      projectId: "prj_new",
      clientIds: ["client_chatgpt"],
    });

    expect(await reached(CHATGPT)).toEqual([]);
  });

  it("writes the grant when a project is registered through the API", async () => {
    await authorize(CLAUDE, ["prj_one", "prj_two"], true);

    const response = await call("/api/projects", {
      method: "POST",
      body: { deviceId: "dev_c", name: "fresh", slug: "fresh", localPath: "/work/fresh" },
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    expect(await reached(CLAUDE)).toContain(id);
  });

  it("can be switched on from the dashboard, which grants what was missing", async () => {
    await authorize(CHATGPT, ["prj_one"], false);

    const response = await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_chatgpt", projectIds: [], allProjects: true },
    });

    expect(response.status).toBe(200);
    expect(await reached(CHATGPT)).toEqual(["prj_one", "prj_two"]);
    expect(await flag(CHATGPT)).toBe(true);

    const listed = (await (await call("/api/account-clients")).json()) as Array<{
      clientId: string;
      allProjects: boolean;
    }>;
    expect(listed.find((client) => client.clientId === "client_chatgpt")?.allProjects).toBe(true);
  });

  it("stops being everything once a list names the projects", async () => {
    await authorize(CLAUDE, ["prj_one", "prj_two"], true);

    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_one"] },
    });

    expect(await flag(CLAUDE)).toBe(false);
    await addProject("prj_new");
    await grantNewProject(env, { userId: USER, projectId: "prj_new" });
    expect(await reached(CLAUDE)).toEqual(["prj_one"]);
  });

  it("stops being everything once one project is taken away by hand", async () => {
    await authorize(CLAUDE, ["prj_one", "prj_two"], true);
    const row = await db(env)
      .select({ id: schema.projectClients.id })
      .from(schema.projectClients)
      .where(
        and(
          eq(schema.projectClients.clientId, "client_claude"),
          eq(schema.projectClients.projectId, "prj_two"),
          eq(schema.projectClients.endpoint, "account"),
        ),
      )
      .get();

    const { bindings } = provider([]);
    await call(`/api/clients/${row?.id}`, { method: "DELETE", bindings });

    expect(await flag(CLAUDE)).toBe(false);
    expect(await reached(CLAUDE)).toEqual(["prj_one"]);
  });

  it("is listed while the account has no project to give it", async () => {
    await db(env).delete(schema.projects).where(eq(schema.projects.userId, USER)).run();
    await authorize(CLAUDE, [], true);

    const listed = (await (await call("/api/account-clients")).json()) as Array<{
      clientId: string;
      allProjects: boolean;
      projects: unknown[];
    }>;

    expect(listed).toEqual([
      expect.objectContaining({ clientId: "client_claude", allProjects: true, projects: [] }),
    ]);

    await addProject("prj_first");
    await grantNewProject(env, { userId: USER, projectId: "prj_first" });
    expect(await reached(CLAUDE)).toEqual(["prj_first"]);
  });

  it("cannot be switched on for a client that was never connected", async () => {
    const response = await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_stranger", projectIds: [], allProjects: true },
    });

    expect(response.status).toBe(404);
    expect(await reached({ userId: USER, clientId: "client_stranger" })).toEqual([]);
  });
});

describe("the account consent screen", () => {
  const page = (options: { allProjects: boolean; projects: number }) =>
    accountConsentPage({
      client: null,
      userEmail: "you@example.com",
      state: "state",
      scopes: [],
      allProjects: options.allProjects,
      projects: Array.from({ length: options.projects }, (_, index) => ({
        id: `prj_${index}`,
        project: `project ${index}`,
        machine: "minipc",
        localPath: "/work",
        repository: null,
        locations: ["minipc"],
        granted: false,
      })),
    }).toString();

  it("offers everything and a chosen list, with one of them selected", async () => {
    const all = await page({ allProjects: true, projects: 2 });
    expect(all).toMatch(/value="all"\s+checked/);
    expect(all).not.toMatch(/value="chosen"\s+checked/);
    expect(all).toContain('name="project"');

    const chosen = await page({ allProjects: false, projects: 2 });
    expect(chosen).toMatch(/value="chosen"\s+checked/);
    expect(chosen).not.toMatch(/value="all"\s+checked/);
  });

  it("can be approved by an account that has no project yet", async () => {
    const empty = await page({ allProjects: false, projects: 0 });
    expect(empty).toMatch(/value="all"\s+checked/);
    expect(empty).toContain('value="approve"');
    expect(empty).not.toContain('name="project"');
  });
});

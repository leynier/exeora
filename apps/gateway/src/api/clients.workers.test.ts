import { createExecutionContext, env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * Revoking and deleting an AI client's access to a project.
 *
 * The two steps mirror machines, and for the same reason: revoking is immediate
 * and undone by authorizing again, while deleting takes the audit trail and
 * unregisters the application, so it must be unreachable by accident.
 *
 * The provider is stubbed because grants and client registrations live in KV
 * behind it, and what matters here is exactly which of them are touched: a
 * revocation that reaches into another project's grant, or a deletion that
 * unregisters a client someone else is also using, are both silent failures.
 */

const USER = "usr_clients_test";
const OTHER = "usr_someone_else";

const CLI_CLIENT = "first_party_cli";
const DASHBOARD_CLIENT = "first_party_dashboard";

interface Recorded {
  revoked: string[];
  deleted: string[];
}

/** Stands in for `@cloudflare/workers-oauth-provider` and its KV namespace. */
function provider(
  grants: Array<{
    id: string;
    clientId: string;
    projectId: string | null;
    /** Present instead of `projectId` on a grant made through the account URL. */
    projectIds?: string[];
  }>,
) {
  const recorded: Recorded = { revoked: [], deleted: [] };

  const bindings = {
    OAUTH_PROVIDER: {
      listUserGrants: async (userId: string) => ({
        items: grants.map((grant) => ({
          id: grant.id,
          clientId: grant.clientId,
          userId,
          scope: [],
          metadata: {
            projectId: grant.projectId,
            ...(grant.projectIds ? { projectIds: grant.projectIds } : {}),
          },
          createdAt: 0,
        })),
      }),
      revokeGrant: async (grantId: string) => {
        recorded.revoked.push(grantId);
      },
      deleteClient: async (clientId: string) => {
        recorded.deleted.push(clientId);
      },
      lookupClient: async (clientId: string) => ({ clientId }),
    },
    // The two first-party ids are already registered, so asking for them is a
    // read and never registers anything.
    OAUTH_KV: {
      get: async (key: string) =>
        key === "cli_client_id"
          ? CLI_CLIENT
          : key === "dashboard_client_id"
            ? DASHBOARD_CLIENT
            : null,
      put: async () => undefined,
    },
  };

  return { recorded, bindings };
}

function call(
  path: string,
  options: {
    method?: string;
    userId?: string;
    bindings?: Record<string, unknown>;
    body?: unknown;
  } = {},
) {
  const request = new Request(`https://exeora.dev${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }),
  });
  const ctx = createExecutionContext();
  // What the OAuth provider attaches once it has validated the bearer token.
  (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? USER };

  return api.fetch(request, { ...env, ...options.bindings } as typeof env, ctx);
}

/**
 * Two projects, and a client authorized against both, so "revoke here" and
 * "delete here" can be shown not to reach the other one.
 */
async function seed({ revoked }: { revoked: boolean }) {
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
    .values({ id: "dev_c", userId: USER, name: "minipc", platform: "linux" })
    .run();

  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_one",
        userId: USER,
        deviceId: "dev_c",
        name: "api",
        slug: "api-c",
        localPath: "/work/api",
      },
      {
        id: "prj_two",
        userId: USER,
        deviceId: "dev_c",
        name: "web",
        slug: "web-c",
        localPath: "/work/web",
      },
    ])
    .run();

  await database
    .insert(schema.projectClients)
    .values({
      id: "pcl_one",
      userId: USER,
      projectId: "prj_one",
      clientId: "client_claude",
      clientName: "Claude",
      authorizedAt: new Date(),
      revokedAt: revoked ? new Date() : null,
    })
    .run();

  await database
    .insert(schema.toolCalls)
    .values([
      // The one that should go.
      {
        id: "call_target",
        userId: USER,
        projectId: "prj_one",
        tool: "read_file",
        status: "ok",
        durationMs: 12,
        clientId: "client_claude",
        clientName: "Claude",
      },
      // Same project, a different client.
      {
        id: "call_other_client",
        userId: USER,
        projectId: "prj_one",
        tool: "grep",
        status: "ok",
        durationMs: 8,
        clientId: "client_chatgpt",
        clientName: "ChatGPT",
      },
      // Same client, a different project.
      {
        id: "call_other_project",
        userId: USER,
        projectId: "prj_two",
        tool: "list_files",
        status: "ok",
        durationMs: 4,
        clientId: "client_claude",
        clientName: "Claude",
      },
    ])
    .run();
}

/** Authorizes the same client against the second project too. */
async function alsoOnSecondProject(clientId = "client_claude") {
  await db(env)
    .insert(schema.projectClients)
    .values({
      id: "pcl_two",
      userId: USER,
      projectId: "prj_two",
      clientId,
      clientName: "Claude",
      authorizedAt: new Date(),
    })
    .run();
}

const surviving = async () => {
  const [clients, calls] = await Promise.all([
    db(env)
      .select()
      .from(schema.projectClients)
      .where(eq(schema.projectClients.userId, USER))
      .all(),
    db(env).select().from(schema.toolCalls).where(eq(schema.toolCalls.userId, USER)).all(),
  ]);
  return { clients: clients.map((row) => row.id), calls: calls.map((row) => row.id).sort() };
};

describe("listing", () => {
  it("names the client rather than exposing the raw client id alone", async () => {
    await seed({ revoked: false });

    const body = (await (await call("/api/clients")).json()) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "pcl_one",
      projectId: "prj_one",
      clientName: "Claude",
      revokedAt: null,
    });
  });

  it("shows one account nothing of another's", async () => {
    await seed({ revoked: false });

    expect(await (await call("/api/clients", { userId: OTHER })).json()).toEqual([]);
  });
});

describe("revoking", () => {
  beforeEach(async () => {
    await seed({ revoked: false });
  });

  it("keeps the row, so the second step is still offered", async () => {
    const { bindings } = provider([]);

    const response = await call("/api/clients/pcl_one", { method: "DELETE", bindings });

    expect(response.status).toBe(200);

    const row = await db(env)
      .select({ revokedAt: schema.projectClients.revokedAt })
      .from(schema.projectClients)
      .where(eq(schema.projectClients.id, "pcl_one"))
      .get();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("drops every grant for this client on this project, and only those", async () => {
    const { recorded, bindings } = provider([
      // Two grants for the pair being revoked: a client that reconnects gets a
      // fresh one each time, and leaving an old one behind leaves access open.
      { id: "grant_a", clientId: "client_claude", projectId: "prj_one" },
      { id: "grant_b", clientId: "client_claude", projectId: "prj_one" },
      // Same client, another project.
      { id: "grant_c", clientId: "client_claude", projectId: "prj_two" },
      // Another client, same project.
      { id: "grant_d", clientId: "client_chatgpt", projectId: "prj_one" },
      // The CLI's own grant, which names no project at all.
      { id: "grant_e", clientId: CLI_CLIENT, projectId: null },
    ]);

    await call("/api/clients/pcl_one", { method: "DELETE", bindings });

    expect(recorded.revoked.sort()).toEqual(["grant_a", "grant_b"]);
  });

  it("does not let one account revoke another's client", async () => {
    const { recorded, bindings } = provider([
      { id: "grant_a", clientId: "client_claude", projectId: "prj_one" },
    ]);

    const response = await call("/api/clients/pcl_one", {
      method: "DELETE",
      userId: OTHER,
      bindings,
    });

    expect(response.status).toBe(404);
    expect(recorded.revoked).toEqual([]);
  });
});

describe("deleting permanently", () => {
  it("refuses a client that has not been revoked", async () => {
    await seed({ revoked: false });
    const { recorded, bindings } = provider([]);

    const response = await call("/api/clients/pcl_one/permanently", {
      method: "DELETE",
      bindings,
    });

    // 409 rather than 403: the request is allowed, the client is in the wrong
    // state for it. Revoking first is what keeps this out of misclick range.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_revoked" });
    expect(recorded.deleted).toEqual([]);
    expect((await surviving()).clients).toEqual(["pcl_one"]);
  });

  describe("once it is revoked", () => {
    beforeEach(async () => {
      await seed({ revoked: true });
    });

    it("takes this project's calls by that client, and leaves the rest", async () => {
      const { bindings } = provider([]);

      const response = await call("/api/clients/pcl_one/permanently", {
        method: "DELETE",
        bindings,
      });

      expect(response.status).toBe(200);
      expect(await surviving()).toEqual({
        clients: [],
        calls: ["call_other_client", "call_other_project"],
      });
    });

    it("unregisters the application once nothing of the user's points at it", async () => {
      const { recorded, bindings } = provider([]);

      await call("/api/clients/pcl_one/permanently", { method: "DELETE", bindings });

      expect(recorded.deleted).toEqual(["client_claude"]);
    });

    it("keeps the application registered while another project still uses it", async () => {
      await alsoOnSecondProject();
      const { recorded, bindings } = provider([]);

      await call("/api/clients/pcl_one/permanently", { method: "DELETE", bindings });

      expect(recorded.deleted).toEqual([]);
      expect((await surviving()).clients).toEqual(["pcl_two"]);
    });

    it("keeps the application registered while another account still uses it", async () => {
      // The same registration, authorized by someone else against their own
      // project. One person finishing with an application must not unregister
      // it out from under everyone else running the same software.
      await db(env)
        .insert(schema.devices)
        .values({ id: "dev_theirs", userId: OTHER, name: "laptop", platform: "linux" })
        .run();

      await db(env)
        .insert(schema.projects)
        .values({
          id: "prj_theirs",
          userId: OTHER,
          deviceId: "dev_theirs",
          name: "theirs",
          slug: "theirs-c",
          localPath: "/work/theirs",
        })
        .run();

      await db(env)
        .insert(schema.projectClients)
        .values({
          id: "pcl_elsewhere",
          userId: OTHER,
          projectId: "prj_theirs",
          clientId: "client_claude",
          clientName: "Claude",
          authorizedAt: new Date(),
        })
        .run();

      const { recorded, bindings } = provider([]);

      await call("/api/clients/pcl_one/permanently", { method: "DELETE", bindings });

      expect(recorded.deleted).toEqual([]);
    });

    it("does not let one account delete another's client", async () => {
      const { bindings } = provider([]);

      const response = await call("/api/clients/pcl_one/permanently", {
        method: "DELETE",
        userId: OTHER,
        bindings,
      });

      expect(response.status).toBe(404);
      expect((await surviving()).clients).toEqual(["pcl_one"]);
    });

    it("404s on a client that does not exist", async () => {
      const { bindings } = provider([]);

      expect(
        (await call("/api/clients/pcl_nope/permanently", { method: "DELETE", bindings })).status,
      ).toBe(404);
    });
  });

  /**
   * A metadata-document client id is a URL its author publishes, so every user
   * of that software shares one registration. Deleting it because one account
   * finished with it would break all the others.
   */
  it("never unregisters a client identified by a metadata document", async () => {
    await seed({ revoked: true });
    await db(env)
      .update(schema.projectClients)
      .set({ clientId: "https://claude.ai/.well-known/oauth-client" })
      .where(eq(schema.projectClients.id, "pcl_one"))
      .run();

    const { recorded, bindings } = provider([]);

    const response = await call("/api/clients/pcl_one/permanently", {
      method: "DELETE",
      bindings,
    });

    expect(response.status).toBe(200);
    expect(recorded.deleted).toEqual([]);
    expect((await surviving()).clients).toEqual([]);
  });

  it("never unregisters Exeora's own CLI or dashboard", async () => {
    await seed({ revoked: true });
    await db(env)
      .update(schema.projectClients)
      .set({ clientId: CLI_CLIENT })
      .where(eq(schema.projectClients.id, "pcl_one"))
      .run();

    const { recorded, bindings } = provider([]);

    await call("/api/clients/pcl_one/permanently", { method: "DELETE", bindings });

    expect(recorded.deleted).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("is scoped to the pair, not to the client across every project", async () => {
    await seed({ revoked: true });
    const { bindings } = provider([]);

    await call("/api/clients/pcl_one/permanently", { method: "DELETE", bindings });

    const elsewhere = await db(env)
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.clientId, "client_claude"), eq(schema.toolCalls.userId, USER)))
      .all();

    expect(elsewhere.map((row) => row.projectId)).toEqual(["prj_two"]);
  });
});

/**
 * The account URL, where one client reaches several projects.
 *
 * The rows are the same table, which is what makes the dashboard's per-project
 * revoke work here too, but `endpoint` keeps the two consents apart: an
 * application authorized both ways holds two grants, and taking one away must
 * leave the other standing.
 */
describe("clients on the account URL", () => {
  async function seedAccount(projectIds: string[]) {
    await seed({ revoked: false });

    await db(env)
      .insert(schema.projectClients)
      .values(
        projectIds.map((projectId, index) => ({
          id: `pcl_acct_${index}`,
          userId: USER,
          projectId,
          clientId: "client_claude",
          endpoint: "account" as const,
          clientName: "Claude",
          authorizedAt: new Date(),
        })),
      )
      .run();
  }

  /** What the dashboard would draw as this client's active project. */
  const activeShownFor = async (clientId: string) => {
    const body = (await (await call("/api/account-clients")).json()) as Array<{
      clientId: string;
      activeProjectId: string | null;
    }>;
    return body.find((row) => row.clientId === clientId)?.activeProjectId ?? null;
  };

  const accountRows = async () =>
    db(env)
      .select()
      .from(schema.projectClients)
      .where(
        and(eq(schema.projectClients.userId, USER), eq(schema.projectClients.endpoint, "account")),
      )
      .all();

  it("groups one entry per client rather than one per project", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    const body = (await (await call("/api/account-clients")).json()) as Array<
      Record<string, unknown>
    >;

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ clientId: "client_claude", activeProjectId: null });

    const reached = (body[0]?.projects ?? []) as Array<{ projectId: string }>;
    expect(reached.map((entry) => entry.projectId).sort()).toEqual(["prj_one", "prj_two"]);
  });

  /**
   * A call resolves to one project and marks only that project's row, while one
   * consent writes every row with the same `authorizedAt`. Summarising the
   * client from whichever row sorts first would report a connection used minutes
   * ago as never used, whenever the project it works in is not the newest.
   */
  it("reports the most recent use across every project, not the newest row's", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    const used = new Date();
    await db(env)
      .update(schema.projectClients)
      .set({ lastUsedAt: used, mcpName: "claude-code", mcpVersion: "2.0.0" })
      .where(eq(schema.projectClients.projectId, "prj_two"))
      .run();

    const body = (await (await call("/api/account-clients")).json()) as Array<
      Record<string, unknown>
    >;

    expect(body[0]).toMatchObject({
      lastUsedAt: used.getTime(),
      mcpName: "claude-code",
      mcpVersion: "2.0.0",
    });
  });

  it("leaves the per-project list showing only its own rows", async () => {
    await seedAccount(["prj_two"]);

    const body = (await (await call("/api/clients")).json()) as Array<Record<string, unknown>>;

    expect(body.map((row) => row.endpoint).sort()).toEqual(["account", "project"]);
  });

  it("treats the submitted list as the whole access list", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    const response = await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_two"] },
    });

    expect(response.status).toBe(200);

    const rows = await accountRows();
    expect(Object.fromEntries(rows.map((row) => [row.projectId, row.revokedAt === null]))).toEqual({
      prj_one: false,
      prj_two: true,
    });
  });

  it("restores a project that comes back, rather than adding a second row", async () => {
    await seedAccount(["prj_one"]);

    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: [] },
    });
    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_one"] },
    });

    const rows = await accountRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).toBeNull();
  });

  /**
   * Emptying the list is how this page cuts a connection off, and the dashboard
   * asks first. A list that arrives non-empty and narrows to nothing is a stale
   * tab, not that decision, and must not take the token away on its behalf.
   */
  it("refuses a non-empty list whose every project is stale", async () => {
    await seedAccount(["prj_one"]);

    const { recorded, bindings } = provider([
      { id: "grant_acct", clientId: "client_claude", projectId: null, projectIds: ["prj_one"] },
    ]);

    const response = await call("/api/account-clients/projects", {
      method: "PUT",
      bindings,
      body: { clientId: "client_claude", projectIds: ["prj_gone", "prj_someone_else"] },
    });

    expect(response.status).toBe(404);
    expect(recorded.revoked).toEqual([]);

    const rows = await accountRows();
    expect(rows.map((row) => row.revokedAt)).toEqual([null]);
  });

  it("drops a project that is not the caller's", async () => {
    await seedAccount(["prj_one"]);

    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_one", "prj_someone_else"] },
    });

    const rows = await accountRows();
    expect(rows.map((row) => row.projectId)).toEqual(["prj_one"]);
  });

  it("never touches the row granted through the project's own URL", async () => {
    await seedAccount(["prj_one"]);

    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: [] },
    });

    const perProject = await db(env)
      .select({ revokedAt: schema.projectClients.revokedAt })
      .from(schema.projectClients)
      .where(eq(schema.projectClients.id, "pcl_one"))
      .get();

    expect(perProject?.revokedAt).toBeNull();
  });

  /**
   * An account grant is one token for `/mcp`, shared by every project on the
   * connection. Revoking one project must leave it alone, or removing a
   * repository from a client would cut off every other at the same time.
   */
  it("keeps the grant while any project is left, and drops it with the last", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    const first = provider([
      { id: "grant_acct", clientId: "client_claude", projectId: null, projectIds: ["prj_one"] },
    ]);
    await call("/api/clients/pcl_acct_0", { method: "DELETE", bindings: first.bindings });
    expect(first.recorded.revoked).toEqual([]);

    const second = provider([
      { id: "grant_acct", clientId: "client_claude", projectId: null, projectIds: ["prj_one"] },
    ]);
    await call("/api/clients/pcl_acct_1", { method: "DELETE", bindings: second.bindings });
    expect(second.recorded.revoked).toEqual(["grant_acct"]);
  });

  /**
   * Revoking project by project ends the same way as emptying the list, so it
   * has to leave the same state behind. A pointer left naming a project nobody
   * may reach is invisible while the access is gone and comes back the moment
   * that project is granted again.
   */
  it("stops naming a choice it can no longer reach, revoked one row at a time", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });

    const { bindings } = provider([]);
    await call("/api/clients/pcl_acct_0", { method: "DELETE", bindings });
    await call("/api/clients/pcl_acct_1", { method: "DELETE", bindings });

    expect(await activeShownFor("client_claude")).toBeNull();
  });

  it("keeps the audit trail while the client still reaches the project another way", async () => {
    await seedAccount(["prj_one"]);

    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.id, "pcl_acct_0"))
      .run();

    const { bindings } = provider([]);
    await call("/api/clients/pcl_acct_0/permanently", { method: "DELETE", bindings });

    const calls = await db(env)
      .select({ id: schema.toolCalls.id })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "call_target"))
      .get();

    expect(calls).toBeDefined();
  });

  it("points a client at a project it reaches, and refuses one it does not", async () => {
    await seedAccount(["prj_one"]);

    expect(
      (
        await call("/api/account-clients/active-project", {
          method: "PUT",
          body: { clientId: "client_claude", projectId: "prj_two" },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await call("/api/account-clients/active-project", {
          method: "PUT",
          body: { clientId: "client_claude", projectId: "prj_one" },
        })
      ).status,
    ).toBe(200);

    const row = await db(env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, USER))
      .get();

    expect(row?.projectId).toBe("prj_one");
  });

  it("takes the token too when the list is emptied from the dashboard", async () => {
    await seedAccount(["prj_one"]);

    const { recorded, bindings } = provider([
      { id: "grant_acct", clientId: "client_claude", projectId: null, projectIds: ["prj_one"] },
      // A grant for the same client on its own project URL, which this must not
      // touch: that is a different consent and nobody asked to end it.
      { id: "grant_project", clientId: "client_claude", projectId: "prj_one" },
    ]);

    await call("/api/account-clients/projects", {
      method: "PUT",
      bindings,
      body: { clientId: "client_claude", projectIds: [] },
    });

    expect(recorded.revoked).toEqual(["grant_acct"]);
  });

  it("stops naming a choice once the last project goes", async () => {
    await seedAccount(["prj_one"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });
    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: [] },
    });

    expect(await activeShownFor("client_claude")).toBeNull();
  });

  /**
   * The dashboard must not offer a choice the connection cannot act on, and the
   * row itself must survive it: keeping the row is what lets a tool call tell a
   * client that never chose from one whose choice was taken away, and refuse
   * the second rather than quietly move it to whatever is left.
   */
  it("stops naming a revoked choice while keeping the record that one was made", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });
    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_two"] },
    });

    expect(await activeShownFor("client_claude")).toBeNull();

    const row = await db(env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, USER))
      .get();
    expect(row?.projectId).toBe("prj_one");
  });

  it("does the same when that project is revoked one row at a time", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });

    const { bindings } = provider([]);
    await call("/api/clients/pcl_acct_0", { method: "DELETE", bindings });

    expect(await activeShownFor("client_claude")).toBeNull();
  });

  it("names it again if that project is granted back", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });
    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_two"] },
    });
    await call("/api/account-clients/projects", {
      method: "PUT",
      body: { clientId: "client_claude", projectIds: ["prj_one", "prj_two"] },
    });

    expect(await activeShownFor("client_claude")).toBe("prj_one");
  });

  /**
   * Revoking closes access and keeps the record, so a pointer left behind is
   * what lets the next call be refused instead of moved. Deleting erases the
   * record, and the pointer must go with it: the same client authorizing again
   * later is a new connection that chose nothing, and meeting a choice made by
   * the one the user asked to forget would refuse its first call.
   */
  it("takes the pointer with a client that is deleted for good", async () => {
    await seedAccount(["prj_one"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_one" },
    });

    const { bindings } = provider([]);
    await call("/api/clients/pcl_acct_0", { method: "DELETE", bindings });
    await call("/api/clients/pcl_acct_0/permanently", { method: "DELETE", bindings });

    const row = await db(env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, USER))
      .get();

    expect(row).toBeUndefined();
  });

  it("leaves it alone while the client still holds another project", async () => {
    await seedAccount(["prj_one", "prj_two"]);

    await call("/api/account-clients/active-project", {
      method: "PUT",
      body: { clientId: "client_claude", projectId: "prj_two" },
    });

    const { bindings } = provider([]);
    await call("/api/clients/pcl_acct_0", { method: "DELETE", bindings });
    await call("/api/clients/pcl_acct_0/permanently", { method: "DELETE", bindings });

    const row = await db(env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, USER))
      .get();

    expect(row?.projectId).toBe("prj_two");
  });

  it("shows one account nothing of another's", async () => {
    await seedAccount(["prj_one"]);

    expect(await (await call("/api/account-clients", { userId: OTHER })).json()).toEqual([]);
    expect(
      (
        await call("/api/account-clients/projects", {
          method: "PUT",
          userId: OTHER,
          body: { clientId: "client_claude", projectIds: ["prj_one"] },
        })
      ).status,
    ).toBe(404);
  });
});

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
function provider(grants: Array<{ id: string; clientId: string; projectId: string | null }>) {
  const recorded: Recorded = { revoked: [], deleted: [] };

  const bindings = {
    OAUTH_PROVIDER: {
      listUserGrants: async (userId: string) => ({
        items: grants.map((grant) => ({
          id: grant.id,
          clientId: grant.clientId,
          userId,
          scope: [],
          metadata: { projectId: grant.projectId },
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
  options: { method?: string; userId?: string; bindings?: Record<string, unknown> } = {},
) {
  const request = new Request(`https://exeora.dev${path}`, { method: options.method ?? "GET" });
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

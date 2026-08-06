import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * Deleting an account.
 *
 * The order the endpoint works in is the thing worth pinning down, because
 * every step depends on the one before it: sockets close before grants are
 * revoked, grants before the rows go, and the rows before any client is
 * unregistered, since whether a client is still wanted is answered by exactly
 * the rows that step just removed.
 *
 * The account next door is present throughout, and nothing may reach it.
 */

const USER = "usr_account_test";
const OTHER = "usr_account_other";

const CLI_CLIENT = "first_party_cli";
const DASHBOARD_CLIENT = "first_party_dashboard";

interface Recorded {
  revoked: string[];
  deleted: string[];
}

/** Stands in for the OAuth provider, whose grants and clients live in KV. */
function provider(grants: Array<{ id: string; clientId: string; userId: string }>) {
  const recorded: Recorded = { revoked: [], deleted: [] };

  const bindings = {
    OAUTH_PROVIDER: {
      listUserGrants: async (userId: string) => ({
        items: grants
          .filter((grant) => grant.userId === userId)
          .map((grant) => ({
            id: grant.id,
            clientId: grant.clientId,
            userId,
            scope: [],
            metadata: { projectId: "prj_mine" },
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

/** Everything one account can own, plus a neighbour who owns the same shapes. */
async function seed() {
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
    .values([
      { id: "dev_mine", userId: USER, name: "minipc", platform: "linux" },
      { id: "dev_theirs", userId: OTHER, name: "laptop", platform: "darwin" },
    ])
    .run();

  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_mine",
        userId: USER,
        deviceId: "dev_mine",
        name: "api",
        slug: "api-a",
        localPath: "/work/api",
      },
      {
        id: "prj_theirs",
        userId: OTHER,
        deviceId: "dev_theirs",
        name: "web",
        slug: "web-a",
        localPath: "/work/web",
      },
    ])
    .run();

  await database
    .insert(schema.projectClients)
    .values([
      {
        id: "pcl_mine",
        userId: USER,
        projectId: "prj_mine",
        clientId: "client_claude",
        clientName: "Claude",
        authorizedAt: new Date(),
      },
      // The same registration, authorized by the account next door. Deleting it
      // would break software this account has nothing to do with.
      {
        id: "pcl_shared",
        userId: OTHER,
        projectId: "prj_theirs",
        clientId: "client_shared",
        clientName: "Cursor",
        authorizedAt: new Date(),
      },
      {
        id: "pcl_mine_shared",
        userId: USER,
        projectId: "prj_mine",
        clientId: "client_shared",
        clientName: "Cursor",
        authorizedAt: new Date(),
      },
    ])
    .run();

  await database
    .insert(schema.toolCalls)
    .values([
      {
        id: "call_mine",
        userId: USER,
        projectId: "prj_mine",
        tool: "read_file",
        status: "ok",
        durationMs: 3,
        clientId: "client_claude",
        clientName: "Claude",
      },
      {
        id: "call_theirs",
        userId: OTHER,
        projectId: "prj_theirs",
        tool: "grep",
        status: "ok",
        durationMs: 4,
        clientId: "client_shared",
        clientName: "Cursor",
      },
    ])
    .run();
}

async function surviving() {
  const database = db(env);

  return {
    users: (await database.select().from(schema.users).all()).map((row) => row.id),
    devices: (await database.select().from(schema.devices).all()).map((row) => row.id),
    projects: (await database.select().from(schema.projects).all()).map((row) => row.id),
    clients: (await database.select().from(schema.projectClients).all()).map((row) => row.id),
    calls: (await database.select().from(schema.toolCalls).all()).map((row) => row.id),
  };
}

beforeEach(seed);

describe("deleting an account", () => {
  it("takes everything the account owned", async () => {
    const { bindings } = provider([]);

    const response = await call("/api/me", { method: "DELETE", bindings });
    expect(response.status).toBe(200);

    const left = await surviving();
    expect(left.users).toEqual([OTHER]);
    expect(left.devices).toEqual(["dev_theirs"]);
    expect(left.projects).toEqual(["prj_theirs"]);
    expect(left.clients).toEqual(["pcl_shared"]);
    expect(left.calls).toEqual(["call_theirs"]);
  });

  it("revokes every grant the account held, whichever client it was for", async () => {
    const { recorded, bindings } = provider([
      { id: "grant_a", clientId: "client_claude", userId: USER },
      { id: "grant_b", clientId: "client_shared", userId: USER },
      { id: "grant_theirs", clientId: "client_shared", userId: OTHER },
    ]);

    await call("/api/me", { method: "DELETE", bindings });

    // Both of this account's, and neither of the neighbour's.
    expect(recorded.revoked.toSorted()).toEqual(["grant_a", "grant_b"]);
  });

  it("unregisters a client nobody else authorized", async () => {
    const { recorded, bindings } = provider([]);

    await call("/api/me", { method: "DELETE", bindings });

    expect(recorded.deleted).toEqual(["client_claude"]);
  });

  it("leaves a client the account next door still uses", async () => {
    const { recorded, bindings } = provider([]);

    await call("/api/me", { method: "DELETE", bindings });

    // `client_shared` was authorized by both accounts. Unregistering it here
    // would break the other one, silently and from the outside.
    expect(recorded.deleted).not.toContain("client_shared");
  });

  it("never unregisters Exeora's own CLI or dashboard", async () => {
    await db(env)
      .update(schema.projectClients)
      .set({ clientId: CLI_CLIENT })
      .where(eq(schema.projectClients.id, "pcl_mine"))
      .run();

    const { recorded, bindings } = provider([]);

    await call("/api/me", { method: "DELETE", bindings });

    expect(recorded.deleted).not.toContain(CLI_CLIENT);
  });

  it("never unregisters a client identified by a metadata document", async () => {
    await db(env)
      .update(schema.projectClients)
      .set({ clientId: "https://claude.ai/.well-known/oauth-client" })
      .where(eq(schema.projectClients.id, "pcl_mine"))
      .run();

    const { recorded, bindings } = provider([]);

    await call("/api/me", { method: "DELETE", bindings });

    expect(recorded.deleted).toEqual([]);
  });

  it("does not touch the account next door when it is the one asking", async () => {
    const { bindings } = provider([]);

    await call("/api/me", { method: "DELETE", userId: OTHER, bindings });

    const left = await surviving();
    expect(left.users).toEqual([USER]);
    expect(left.devices).toEqual(["dev_mine"]);
  });
});

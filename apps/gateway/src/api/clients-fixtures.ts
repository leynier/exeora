import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";

/**
 * The world the client tests run against, and the stub that stands in for the
 * OAuth provider.
 *
 * Shared by the per-project and account-URL suites because they are two halves
 * of the same table and must be seeded identically: a difference in the fixture
 * would look like a difference in behaviour.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
 */

export const USER = "usr_clients_test";
export const OTHER = "usr_someone_else";

export const CLI_CLIENT = "first_party_cli";
export const DASHBOARD_CLIENT = "first_party_dashboard";

export interface Recorded {
  revoked: string[];
  deleted: string[];
}

/** Stands in for `@cloudflare/workers-oauth-provider` and its KV namespace. */
export function provider(
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

export function call(
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
export async function seed({ revoked }: { revoked: boolean }) {
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
}

/** Authorizes the same client against the second project too. */
export async function alsoOnSecondProject(clientId = "client_claude") {
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

export const surviving = async () => {
  const clients = await db(env)
    .select()
    .from(schema.projectClients)
    .where(eq(schema.projectClients.userId, USER))
    .all();
  return { clients: clients.map((row) => row.id) };
};

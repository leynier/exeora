import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { call, OTHER, provider, seed, USER } from "./clients-fixtures.js";

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

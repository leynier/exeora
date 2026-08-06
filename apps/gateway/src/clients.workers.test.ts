import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isMetadataDocumentClient,
  rememberAuthorization,
  rememberMcpClient,
  resolveTarget,
  touchClient,
} from "./clients.js";
import { db, schema } from "./db/client.js";

/**
 * What the gateway knows about the client behind a call, and what it does with
 * that on the way to the executor.
 *
 * The revocation check rides on the project lookup, so it is asserted here
 * rather than through the MCP endpoint: this is the statement that decides
 * whether a revoked client is still served, and it must be wrong in the safe
 * direction if it is wrong at all.
 */

const USER = "usr_clients_unit";
const OTHER = "usr_clients_unit_other";
const CLIENT = "client_claude";

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
    .values({ id: "dev_u", userId: USER, name: "minipc", platform: "linux" })
    .run();

  await database
    .insert(schema.projects)
    .values({
      id: "prj_u",
      userId: USER,
      deviceId: "dev_u",
      name: "api",
      slug: "api-u",
      localPath: "/work/api",
    })
    .run();
}

const row = () =>
  db(env)
    .select()
    .from(schema.projectClients)
    .where(eq(schema.projectClients.projectId, "prj_u"))
    .get();

describe("resolving where a call goes", () => {
  beforeEach(seed);

  it("finds the device for a project the caller owns", async () => {
    const target = await resolveTarget(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
    });

    expect(target).toEqual({ deviceId: "dev_u", clientRevokedAt: null });
  });

  it("finds nothing for another account's project", async () => {
    expect(
      await resolveTarget(env, { userId: OTHER, projectId: "prj_u", clientId: CLIENT }),
    ).toBeNull();
  });

  it("reports a revoked client, so the call can be refused", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.clientId, CLIENT))
      .run();

    const target = await resolveTarget(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
    });

    expect(target?.clientRevokedAt).not.toBeNull();
  });

  it("does not hold one client's revocation against another", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.clientId, CLIENT))
      .run();

    const target = await resolveTarget(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: "client_chatgpt",
    });

    expect(target).toEqual({ deviceId: "dev_u", clientRevokedAt: null });
  });

  /**
   * A caller the OAuth layer accepted but whose grant carries no client id.
   * There is nothing here to have revoked, and the empty string must not be
   * allowed to match a row and hand it some other client's revocation.
   */
  it("serves a caller with no client id at all", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: "",
      clientName: undefined,
      clientUri: undefined,
    });
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.clientId, ""))
      .run();

    const target = await resolveTarget(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: undefined,
    });

    expect(target).toEqual({ deviceId: "dev_u", clientRevokedAt: null });
  });
});

describe("remembering a client", () => {
  beforeEach(seed);

  it("records the registered name when consent is given", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: "https://claude.ai",
    });

    expect(await row()).toMatchObject({
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: "https://claude.ai",
      revokedAt: null,
    });
  });

  it("clears a revocation when the client is authorized again", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.clientId, CLIENT))
      .run();

    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });

    expect((await row())?.revokedAt).toBeNull();
  });

  it("fills in what the client calls itself over MCP", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });

    await rememberMcpClient(
      env,
      { userId: USER, projectId: "prj_u", clientId: CLIENT },
      { name: "claude-code", version: "2.1.0" },
    );

    expect(await row()).toMatchObject({ mcpName: "claude-code", mcpVersion: "2.1.0" });
  });

  /**
   * A client that announced itself once and then stopped must not lose the
   * version it already told us, or the display flickers between two answers.
   */
  it("does not erase what it already knew", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    await rememberMcpClient(
      env,
      { userId: USER, projectId: "prj_u", clientId: CLIENT },
      { name: "claude-code", version: "2.1.0" },
    );

    await touchClient(env, { userId: USER, projectId: "prj_u", clientId: CLIENT }, undefined);

    const after = await row();
    expect(after).toMatchObject({ mcpName: "claude-code", mcpVersion: "2.1.0" });
    expect(after?.lastUsedAt).not.toBeNull();
  });
});

describe("telling a shared registration apart", () => {
  it("recognises a metadata document by its scheme", () => {
    expect(isMetadataDocumentClient("https://claude.ai/.well-known/oauth-client")).toBe(true);
    expect(isMetadataDocumentClient("http://localhost:3000/client.json")).toBe(true);
  });

  it("treats an opaque registration as the account's own", () => {
    expect(isMetadataDocumentClient("bXktY2xpZW50LWlk")).toBe(false);
    expect(isMetadataDocumentClient("")).toBe(false);
  });
});

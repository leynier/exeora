import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeProjectChoice,
  isMetadataDocumentClient,
  parsePolicy,
  rememberAuthorization,
  rememberMcpClient,
  resolveTarget,
  setActiveProjectId,
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

    expect(target).toMatchObject({ deviceId: "dev_u", clientRevokedAt: null });
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

    expect(target).toMatchObject({ deviceId: "dev_u", clientRevokedAt: null });
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

    expect(target).toMatchObject({ deviceId: "dev_u", clientRevokedAt: null });
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

  it("does not rewrite a fresh last-used timestamp", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    const recent = new Date(Date.now() - 1_000);
    await db(env)
      .update(schema.projectClients)
      .set({ lastUsedAt: recent })
      .where(eq(schema.projectClients.clientId, CLIENT))
      .run();

    await touchClient(env, { userId: USER, projectId: "prj_u", clientId: CLIENT }, undefined);

    expect((await row())?.lastUsedAt?.getTime()).toBe(recent.getTime());
  });

  it("learns changed MCP identity even inside the debounce window", async () => {
    await rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      clientName: "Claude",
      clientUri: undefined,
    });
    const recent = new Date(Date.now() - 1_000);
    await db(env)
      .update(schema.projectClients)
      .set({
        lastUsedAt: recent,
        mcpName: "claude-code",
        mcpVersion: "2.1.0",
      })
      .where(eq(schema.projectClients.clientId, CLIENT))
      .run();

    await touchClient(
      env,
      { userId: USER, projectId: "prj_u", clientId: CLIENT },
      { name: "claude-code", version: "2.2.0" },
    );

    const after = await row();
    expect(after).toMatchObject({ mcpName: "claude-code", mcpVersion: "2.2.0" });
    expect(after?.lastUsedAt?.getTime()).toBe(recent.getTime());
  });
});

describe("reading a stored policy", () => {
  it("treats an empty column as no restriction", () => {
    // Every project that predates the setting. Nobody restricted these, so
    // reading them as restricted would break them all at once.
    expect(parsePolicy(null).mode).toBe("allow_all");
    expect(parsePolicy("").mode).toBe("allow_all");
  });

  it("returns what was stored", () => {
    const stored = JSON.stringify({
      mode: "allow_list",
      allow: ["npm"],
      shell: false,
      approve: false,
    });
    expect(parsePolicy(stored)).toEqual({
      mode: "allow_list",
      allow: ["npm"],
      // Filled in by the schema: a policy stored before these fields existed
      // reads as one that has no opinion about them, not as a stricter one.
      deny: [],
      shell: false,
      approve: false,
      tools: null,
    });
  });

  /**
   * The direction this has to fail in. A column holding something illegible is
   * evidence that someone set a policy, so opening the project up is the one
   * answer that can be wrong in a way that matters.
   */
  it("allows nothing when a policy was set but cannot be read", () => {
    expect(parsePolicy("not json at all").mode).toBe("read_only");
    expect(parsePolicy('{"mode":"whatever"}').mode).toBe("read_only");
    expect(parsePolicy("[]").mode).toBe("read_only");
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

/**
 * Telling "never chose a project" from "chose one and lost it".
 *
 * The two must not be collapsed, because the account endpoint sends the first
 * to its only project and has to refuse the second. An agent whose project was
 * revoked still believes it is there, and nothing on a stateless endpoint has
 * told it otherwise, so resolving it somewhere else is how a write meant for
 * one repository lands in another.
 */
describe("the choice a client last made", () => {
  beforeEach(seed);

  const entry = { userId: USER, clientId: CLIENT };

  const grant = async () =>
    rememberAuthorization(env, {
      userId: USER,
      projectId: "prj_u",
      clientId: CLIENT,
      endpoint: "account",
      clientName: "Claude",
      clientUri: undefined,
    });

  const revoke = async () =>
    db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.projectId, "prj_u"))
      .run();

  it("is null when none was ever made", async () => {
    await grant();
    expect(await activeProjectChoice(env, entry)).toBeNull();
  });

  it("stands while the project is still reachable", async () => {
    await grant();
    await setActiveProjectId(env, { ...entry, projectId: "prj_u" });

    expect(await activeProjectChoice(env, entry)).toEqual({
      projectId: "prj_u",
      reachable: true,
    });
  });

  // The distinction the endpoint depends on: still a choice, no longer standing.
  it("survives a revocation, marked as no longer reachable", async () => {
    await grant();
    await setActiveProjectId(env, { ...entry, projectId: "prj_u" });
    await revoke();

    expect(await activeProjectChoice(env, entry)).toEqual({
      projectId: "prj_u",
      reachable: false,
    });
  });

  it("stands again once the project is granted back", async () => {
    await grant();
    await setActiveProjectId(env, { ...entry, projectId: "prj_u" });
    await revoke();
    await grant();

    expect(await activeProjectChoice(env, entry)).toEqual({
      projectId: "prj_u",
      reachable: true,
    });
  });

  it("goes with the project when the project itself is deleted", async () => {
    await grant();
    await setActiveProjectId(env, { ...entry, projectId: "prj_u" });

    await db(env).delete(schema.projects).where(eq(schema.projects.id, "prj_u")).run();

    expect(await activeProjectChoice(env, entry)).toBeNull();
  });
});

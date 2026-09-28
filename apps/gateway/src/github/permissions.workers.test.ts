import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import {
  APP_ID,
  APP_SLUG,
  type Asked,
  authorize,
  call,
  envOn,
  fakeGitHub,
  signature,
} from "./fixtures.js";
import { completeConnection, listInstallations } from "./installations.js";
import { APP_PERMISSIONS, pendingPermissions, storedPermissions } from "./permissions.js";

/**
 * What an installation has accepted of what the app asks for: how it is
 * learned, from a connection and from a delivery, and how it is said.
 */

const USER = "usr_github_perms";
const OTHER = "usr_github_perms_other";
const BYSTANDER = "usr_github_perms_bystander";
const INSTALLATION = 6101;
const ELSEWHERE = 6102;

/** What an installation made before the app asked for more was given. */
const LEGACY = { contents: "write", metadata: "read", pull_requests: "write" };
const ADDED = ["issues", "actions", "checks", "statuses", "workflows"];

beforeEach(async () => {
  const database = db(env);
  for (const id of [USER, OTHER, BYSTANDER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-perms@example.com" },
      { id: OTHER, email: "github-perms-other@example.com" },
      { id: BYSTANDER, email: "github-perms-bystander@example.com" },
    ])
    .run();
});

const held = (id: string, userId: string, installationId: number, permissions?: string | null) => ({
  id,
  userId,
  installationId,
  accountLogin: "acme",
  accountType: "Organization" as const,
  ...(permissions === undefined ? {} : { permissions }),
});

const rows = (installationId: number) =>
  db(env)
    .select({
      userId: schema.githubInstallations.userId,
      permissions: schema.githubInstallations.permissions,
    })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId))
    .orderBy(schema.githubInstallations.userId)
    .all();

describe("what is pending for an installation", () => {
  it("is nothing while GitHub has not said what it holds", () => {
    expect(pendingPermissions(null)).toEqual([]);
    expect(pendingPermissions(undefined)).toEqual([]);
    expect(pendingPermissions("")).toEqual([]);
    // Nor for what was stored and cannot be read: that is not known either.
    expect(pendingPermissions("not json")).toEqual([]);
    expect(pendingPermissions("[]")).toEqual([]);
    expect(pendingPermissions('"write"')).toEqual([]);
  });

  it("is the five that were added, for an installation from before them", () => {
    expect(pendingPermissions(JSON.stringify(LEGACY))).toEqual(ADDED);
  });

  it("is nothing for one that accepted everything", () => {
    expect(pendingPermissions(JSON.stringify(APP_PERMISSIONS))).toEqual([]);
    // More than was asked for is not less than it.
    const generous = { ...APP_PERMISSIONS, actions: "write", contents: "admin", pages: "read" };
    expect(pendingPermissions(JSON.stringify(generous))).toEqual([]);
  });

  it("counts reading where writing is asked, and a level that is no level", () => {
    const reading = { ...APP_PERMISSIONS, issues: "read", contents: "read" };
    expect(pendingPermissions(JSON.stringify(reading))).toEqual(["contents", "issues"]);
    const odd = { ...APP_PERMISSIONS, checks: "none", statuses: 1, actions: null };
    expect(pendingPermissions(JSON.stringify(odd))).toEqual(["actions", "checks", "statuses"]);
    // An installation that was given nothing waits for all of it.
    expect(pendingPermissions("{}")).toEqual(Object.keys(APP_PERMISSIONS));
  });

  it("asks for what the owner decided, by the names GitHub gives them", () => {
    expect(APP_PERMISSIONS).toEqual({
      contents: "write",
      metadata: "read",
      pull_requests: "write",
      issues: "write",
      actions: "read",
      checks: "read",
      statuses: "read",
      workflows: "write",
    });
  });

  it("keeps of what GitHub sends only what reads as a permission", () => {
    expect(storedPermissions(null)).toBeNull();
    expect(storedPermissions("write")).toBeNull();
    expect(storedPermissions(["contents"])).toBeNull();
    expect(storedPermissions({})).toBe("{}");
    expect(
      JSON.parse(
        storedPermissions({
          contents: "write",
          metadata: "read",
          administration: "admin",
          issues: "everything",
          checks: { nested: true },
          "not a name": "read",
        }) ?? "",
      ),
    ).toEqual({ contents: "write", metadata: "read", administration: "admin" });
  });
});

describe("how the dashboard is told", () => {
  it("says what each installation of the account is waiting for", async () => {
    await db(env)
      .insert(schema.githubInstallations)
      .values([
        { ...held("ghi_perms_a", USER, INSTALLATION, JSON.stringify(LEGACY)), accountLogin: "a" },
        {
          ...held("ghi_perms_b", USER, ELSEWHERE, JSON.stringify(APP_PERMISSIONS)),
          accountLogin: "b",
        },
        { ...held("ghi_perms_c", USER, 6103), accountLogin: "c" },
      ])
      .run();
    await authorize(USER);

    expect(await listInstallations(env, USER)).toMatchObject([
      { id: "ghi_perms_a", pendingPermissions: ADDED },
      { id: "ghi_perms_b", pendingPermissions: [] },
      // Never described by GitHub: unknown, which is not pending.
      { id: "ghi_perms_c", pendingPermissions: [] },
    ]);

    const response = await call("/api/github", { userId: USER, env: await envOn() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      installations: Array<{ id: string; pendingPermissions: string[] }>;
    };
    expect(
      body.installations.map((installation) => [installation.id, installation.pendingPermissions]),
    ).toEqual([
      ["ghi_perms_a", ADDED],
      ["ghi_perms_b", []],
      ["ghi_perms_c", []],
    ]);
  });
});

describe("what a connection learns", () => {
  /** A GitHub where the person who authorized sees exactly `installations`. */
  function github(installations: unknown[]) {
    return fakeGitHub((asked: Asked) => {
      if (asked.url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "ghu_perms_token", token_type: "bearer" });
      }
      const url = new URL(asked.url);
      if (url.pathname === "/user") return Response.json({ login: "octocat", id: 583_231 });
      if (url.pathname === "/user/installations") {
        return Response.json({ total_count: installations.length, installations });
      }
      return undefined;
    });
  }

  const installation = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    app_id: Number(APP_ID),
    app_slug: APP_SLUG,
    account: { login: "acme", type: "Organization" },
    repository_selection: "selected",
    suspended_at: null,
    ...extra,
  });

  const connect = async (installations: unknown[]) =>
    completeConnection(
      await envOn(),
      USER,
      { code: "the-code", installationId: null },
      github(installations).fetcher,
    );

  it("stores what GitHub says each installation was given", async () => {
    const result = await connect([
      installation(INSTALLATION, { permissions: LEGACY }),
      installation(ELSEWHERE, {
        account: { login: "globex", type: "Organization" },
        permissions: APP_PERMISSIONS,
      }),
    ]);
    expect(result).toMatchObject({ ok: true, installations: 2 });

    expect(JSON.parse((await rows(INSTALLATION))[0]?.permissions ?? "")).toEqual(LEGACY);
    expect(JSON.parse((await rows(ELSEWHERE))[0]?.permissions ?? "")).toEqual(APP_PERMISSIONS);
    expect(
      (await listInstallations(env, USER)).map((view) => [
        view.installationId,
        view.pendingPermissions,
      ]),
    ).toEqual([
      [INSTALLATION, ADDED],
      [ELSEWHERE, []],
    ]);
  });

  it("brings it up to date when the account connects again", async () => {
    await connect([installation(INSTALLATION, { permissions: LEGACY })]);
    await connect([installation(INSTALLATION, { permissions: APP_PERMISSIONS })]);
    expect(JSON.parse((await rows(INSTALLATION))[0]?.permissions ?? "")).toEqual(APP_PERMISSIONS);
  });

  it("leaves what it knew alone when GitHub does not say", async () => {
    await connect([installation(ELSEWHERE)]);
    expect(await rows(ELSEWHERE)).toEqual([{ userId: USER, permissions: null }]);

    await connect([installation(INSTALLATION, { permissions: APP_PERMISSIONS })]);
    await connect([installation(INSTALLATION)]);
    expect(JSON.parse((await rows(INSTALLATION))[0]?.permissions ?? "")).toEqual(APP_PERMISSIONS);
  });
});

describe("a delivery that says the new permissions were accepted", () => {
  beforeEach(async () => {
    await db(env)
      .insert(schema.githubInstallations)
      .values([
        held("ghi_perms_mine", USER, INSTALLATION, JSON.stringify(LEGACY)),
        // Connected before anything was stored.
        held("ghi_perms_theirs", OTHER, INSTALLATION),
        held("ghi_perms_apart", BYSTANDER, ELSEWHERE, JSON.stringify(LEGACY)),
      ])
      .run();
  });

  const accepted = {
    action: "new_permissions_accepted",
    installation: { id: INSTALLATION, permissions: APP_PERMISSIONS },
  };

  async function deliver(payload: unknown, sign?: string | null) {
    const body = JSON.stringify(payload);
    const signed = sign === undefined ? await signature(body) : sign;
    return worker.fetch(
      new Request("https://exeora.dev/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-GitHub-Event": "installation",
          ...(signed === null ? {} : { "X-Hub-Signature-256": signed }),
        },
        body,
      }),
      (await envOn()) as unknown as Env,
      createExecutionContext(),
    );
  }

  it("is written down for every account that holds the installation", async () => {
    const response = await deliver(accepted);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const stored = await rows(INSTALLATION);
    expect(stored.map((row) => row.userId)).toEqual([USER, OTHER]);
    for (const row of stored) {
      expect(JSON.parse(row.permissions ?? "")).toEqual(APP_PERMISSIONS);
      expect(pendingPermissions(row.permissions)).toEqual([]);
    }
    // Another installation accepted nothing by this.
    expect(await rows(ELSEWHERE)).toEqual([
      { userId: BYSTANDER, permissions: JSON.stringify(LEGACY) },
    ]);
  });

  it("stores what was accepted, which may be less than what is asked", async () => {
    const partly = { ...LEGACY, issues: "write", workflows: "write" };
    await deliver({ ...accepted, installation: { id: INSTALLATION, permissions: partly } });
    for (const row of await rows(INSTALLATION)) {
      expect(pendingPermissions(row.permissions)).toEqual(["actions", "checks", "statuses"]);
    }
  });

  it("is refused unsigned, or signed by somebody else, and changes nothing", async () => {
    const unsigned = await deliver(accepted, null);
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "invalid_signature" });
    const forged = await deliver(
      accepted,
      await signature(JSON.stringify(accepted), "a-secret-that-is-not-the-app's"),
    );
    expect(forged.status).toBe(401);
    // Signed, for a body that named another installation.
    const swapped = await deliver(
      accepted,
      await signature(JSON.stringify({ ...accepted, installation: { id: ELSEWHERE } })),
    );
    expect(swapped.status).toBe(401);

    expect(await rows(INSTALLATION)).toEqual([
      { userId: USER, permissions: JSON.stringify(LEGACY) },
      { userId: OTHER, permissions: null },
    ]);
  });

  it("changes nothing when it does not say what was accepted", async () => {
    const response = await deliver({
      action: "new_permissions_accepted",
      installation: { id: INSTALLATION },
    });
    expect(response.status).toBe(204);
    expect((await rows(INSTALLATION))[0]?.permissions).toBe(JSON.stringify(LEGACY));
  });
});

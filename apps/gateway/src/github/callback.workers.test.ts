import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import worker from "../index.js";
import { APP_ID, envOn, githubWorld, repository, sessionCookie, type TestEnv } from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { repositoriesCacheKey } from "./repositories.js";
import { signConnectState } from "./state.js";

/**
 * The way back from github.com. It is reached by a browser, through the
 * Worker's own entry point and without an access token, so what it believes
 * is what it can check: the state it signed, the session of the browser that
 * carries it, and what GitHub says of the person who authorized.
 */

const USER = "usr_github_callback";
const ATTACKER = "usr_github_callback_attacker";
const INSTALLATION = 8201;
const USER_TOKEN = "ghu_user_token";

let restore: (() => void) | undefined;
let testEnv: TestEnv;

beforeEach(async () => {
  testEnv = await envOn();
  const database = db(env);
  for (const id of [USER, ATTACKER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    await env.OAUTH_KV.delete(repositoriesCacheKey(id, INSTALLATION));
  }
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "github-callback@example.com" },
      { id: ATTACKER, email: "github-callback-attacker@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: "dev_gh_callback", userId: USER, name: "laptop", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: "prj_gh_callback",
      userId: USER,
      deviceId: "dev_gh_callback",
      name: "api",
      slug: "api",
      localPath: "/w/api",
      repoUrl: "https://github.com/octocat/api.git",
      repoKey: "github.com/octocat/api",
    })
    .run();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

/** GitHub as the person who authorizes sees it: one installation, holding one repository. */
function github(options: { visible?: number[] } = {}) {
  const fake = githubWorld(
    {
      installations: { [INSTALLATION]: [repository(41, "octocat/api")] },
      people: { [USER_TOKEN]: { 41: { push: true } } },
    },
    (asked) => {
      if (asked.url === "https://github.com/login/oauth/access_token") {
        return Response.json({
          access_token: USER_TOKEN,
          expires_in: 28_800,
          refresh_token: "ghr_refresh",
        });
      }
      const url = new URL(asked.url);
      if (url.pathname === "/user") return Response.json({ login: "octocat" });
      if (url.pathname === "/user/installations") {
        return Response.json({
          installations: (options.visible ?? [INSTALLATION]).map((id) => ({
            id,
            app_id: Number(APP_ID),
            account: { login: "octocat", type: "User" },
            repository_selection: "selected",
            suspended_at: null,
          })),
        });
      }
      return undefined;
    },
  );
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

/** The browser coming back, signed in to Exeora as `as`, or as nobody. */
async function callback(query: Record<string, string>, as: string | null = USER) {
  const url = new URL("https://exeora.dev/api/github/callback");
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const cookie = as === null ? null : await sessionCookie(as, testEnv);
  return worker.fetch(
    new Request(url, { redirect: "manual", ...(cookie ? { headers: { Cookie: cookie } } : {}) }),
    testEnv,
    createExecutionContext(),
  );
}

const settings = (response: Response) => {
  const url = new URL(response.headers.get("location") ?? "");
  return `${url.pathname}${url.search}`;
};

const installations = (userId: string) =>
  db(env)
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.userId, userId))
    .all();

const tokens = () => db(env).select().from(schema.githubUserTokens).all();

const arriving = async (userId = USER) => ({
  code: "the-code",
  installation_id: String(INSTALLATION),
  setup_action: "install",
  state: await signConnectState(testEnv, userId),
});

describe("the way back from GitHub", () => {
  it("connects the account the state was signed for, and its projects with it", async () => {
    github();
    const response = await callback(await arriving());
    expect(response.status).toBe(302);
    expect(settings(response)).toBe("/dashboard/settings?github=connected");
    expect(new URL(response.headers.get("location") ?? "").origin).toBe(
      new URL(testEnv.EXEORA_BASE_URL).origin,
    );

    expect(await installations(USER)).toMatchObject([{ installationId: INSTALLATION }]);
    expect(await tokens()).toMatchObject([{ userId: USER, login: "octocat" }]);
    // The project the account already had is the repository it now reaches.
    const link = await db(env)
      .select()
      .from(schema.githubRepositories)
      .where(eq(schema.githubRepositories.projectId, "prj_gh_callback"))
      .get();
    expect(link).toMatchObject({ installationId: INSTALLATION, repoId: 41, lostAccessAt: null });
  });

  it("stores nothing for an installation GitHub does not list for that person", async () => {
    // The person sees 8201. The address they were sent back with says 999,
    // which is somebody else's.
    const { asked } = github();
    const response = await callback({ ...(await arriving()), installation_id: "999" });
    expect(settings(response)).toBe(
      "/dashboard/settings?github=failed&reason=installation_not_visible",
    );
    expect(await installations(USER)).toEqual([]);
    expect(await tokens()).toEqual([]);
    // And no token was ever asked for in that installation's name.
    expect(asked.some((request) => request.url.includes("/access_tokens"))).toBe(false);
  });
});

describe("whose browser it is", () => {
  it("stores nothing for a browser that is not signed in to Exeora", async () => {
    const { asked } = github();
    const response = await callback(await arriving(), null);
    expect(response.status).toBe(302);
    expect(settings(response)).toBe("/dashboard/settings?github=failed&reason=session_required");
    expect(await installations(USER)).toEqual([]);
    expect(await tokens()).toEqual([]);
    // The code was never exchanged: GitHub was not asked a thing.
    expect(asked).toEqual([]);
  });

  it("stores nothing when the browser is signed in as somebody else", async () => {
    // The attacker made the link for their own account and sent it to the
    // person, who installed the app and came back in their own browser.
    const { asked } = github();
    const response = await callback(await arriving(ATTACKER), USER);
    expect(settings(response)).toBe("/dashboard/settings?github=failed&reason=session_required");
    expect(await installations(ATTACKER)).toEqual([]);
    expect(await installations(USER)).toEqual([]);
    expect(await tokens()).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("does not take a cookie that is no session", async () => {
    github();
    const url = new URL("https://exeora.dev/api/github/callback");
    for (const [name, value] of Object.entries(await arriving())) {
      url.searchParams.set(name, value);
    }
    const response = await worker.fetch(
      new Request(url, { headers: { Cookie: "exeora_session=v2.not-a-session-anyone-was-given" } }),
      testEnv,
      createExecutionContext(),
    );
    expect(settings(response)).toBe("/dashboard/settings?github=failed&reason=session_required");
    expect(await installations(USER)).toEqual([]);
  });

  it("leaves the state good for the right browser after the wrong one tried it", async () => {
    github();
    const query = await arriving();
    expect(settings(await callback(query, null))).toContain("session_required");
    expect(settings(await callback(query, USER))).toBe("/dashboard/settings?github=connected");
  });
});

describe("the state", () => {
  it("is good once", async () => {
    const { asked } = github();
    const query = await arriving();
    expect(settings(await callback(query))).toBe("/dashboard/settings?github=connected");
    const first = asked.length;

    const again = await callback(query);
    expect(settings(again)).toBe("/dashboard/settings?github=failed&reason=state_used");
    expect(asked.length).toBe(first);
    // With another code as well: it is the state that was spent.
    const other = await callback({ ...query, code: "another-code" });
    expect(settings(other)).toBe("/dashboard/settings?github=failed&reason=state_used");
    expect(await installations(USER)).toHaveLength(1);
  });

  it("is spent by an attempt that failed, too", async () => {
    github({ visible: [] });
    const query = await arriving();
    expect(settings(await callback(query))).toContain("reason=installation_not_visible");
    restore?.();
    github();
    expect(settings(await callback(query))).toBe(
      "/dashboard/settings?github=failed&reason=state_used",
    );
    expect(await installations(USER)).toEqual([]);
  });

  it("is refused when it was not signed here, before GitHub is asked anything", async () => {
    const { asked } = github();
    const forged = await callback({ ...(await arriving()), state: "forged.state" });
    expect(settings(forged)).toBe("/dashboard/settings?github=failed&reason=state_invalid");

    const expired = await callback({
      ...(await arriving()),
      state: await signConnectState(testEnv, USER, Date.now() - 11 * 60_000),
    });
    expect(settings(expired)).toBe("/dashboard/settings?github=failed&reason=state_invalid");

    const nobody = await callback(
      { code: "the-code", state: await signConnectState(testEnv, "usr_who_was_deleted") },
      null,
    );
    expect(settings(nobody)).toBe("/dashboard/settings?github=failed&reason=state_invalid");
    expect(asked).toEqual([]);
    expect(await installations(USER)).toEqual([]);
  });
});

describe("a way back with nothing to exchange", () => {
  it("says why", async () => {
    github();
    const state = () => signConnectState(testEnv, USER);
    expect(settings(await callback({ setup_action: "request", state: await state() }))).toBe(
      "/dashboard/settings?github=failed&reason=approval_pending",
    );
    expect(settings(await callback({ state: await state() }))).toBe(
      "/dashboard/settings?github=failed&reason=code_missing",
    );
    expect(settings(await callback({ error: "access_denied", state: await state() }))).toBe(
      "/dashboard/settings?github=failed&reason=denied",
    );
    expect(
      settings(await callback({ code: "c", installation_id: "1 OR 1=1", state: await state() })),
    ).toBe("/dashboard/settings?github=failed&reason=installation_invalid");
  });
});

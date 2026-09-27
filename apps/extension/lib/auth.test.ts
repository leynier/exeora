import { describe, expect, it } from "vitest";
import { type AuthDeps, createAuth, SESSION_KEY, type StorageArea } from "./auth.js";

const GATEWAY = "https://exeora.test";
const REDIRECT = "https://helnfgncjgikiojakjdfppmmflbdjamo.chromiumapp.org/";

function area(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items);
    },
    remove: async (key) => {
      delete data[key];
    },
  };
}

type Call = { url: string; body: Record<string, string> };

/** A gateway that answers the token endpoint with whatever the test queues. */
function world(responses: Array<() => Response> = []) {
  const calls: Call[] = [];
  let clock = 1_000_000;
  const local = area();
  const session = area();
  const deps: AuthDeps = {
    gateway: GATEWAY,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/extension-client")) {
        return Response.json({
          clientId: "ext_client",
          authorizationEndpoint: `${GATEWAY}/oauth/authorize`,
          tokenEndpoint: `${GATEWAY}/oauth/token`,
          scopes: ["dashboard:manage"],
        });
      }
      calls.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body))) });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected request to ${url}`);
      return next();
    },
    local,
    session,
    identity: {
      getRedirectURL: () => REDIRECT,
      launchWebAuthFlow: async ({ url }) => {
        const state = new URL(url).searchParams.get("state");
        return `${REDIRECT}?code=the_code&state=${state}`;
      },
    },
    now: () => clock,
  };
  return {
    auth: createAuth(deps),
    deps,
    calls,
    local,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const tokens = (access: string, refresh?: string) => () =>
  Response.json({
    access_token: access,
    expires_in: 3600,
    ...(refresh ? { refresh_token: refresh } : {}),
  });

describe("extension sign-in", () => {
  it("exchanges the code with PKCE and keeps the refresh token across restarts", async () => {
    const { auth, calls, local } = world([tokens("a1", "r1")]);
    await auth.signIn();

    expect(calls[0]?.body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "ext_client",
      code: "the_code",
      redirect_uri: REDIRECT,
    });
    expect(calls[0]?.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(local.data[SESSION_KEY]).toEqual({ refreshToken: "r1", clientId: "ext_client" });
    expect(await auth.token()).toBe("a1");
  });

  it("refuses a response whose state is not this sign-in's", async () => {
    const { auth, deps, local } = world();
    deps.identity.launchWebAuthFlow = async () => `${REDIRECT}?code=x&state=someone-else`;
    await expect(auth.signIn()).rejects.toThrow("did not match");
    expect(local.data[SESSION_KEY]).toBeUndefined();
  });

  it("says so when the consent screen is declined", async () => {
    const { auth, deps } = world();
    deps.identity.launchWebAuthFlow = async ({ url }) =>
      `${REDIRECT}?error=access_denied&state=${new URL(url).searchParams.get("state")}`;
    await expect(auth.signIn()).rejects.toThrow("Access was not authorized.");
  });
});

describe("extension tokens", () => {
  it("refreshes an expiring access token and saves the rotated refresh token", async () => {
    const { auth, calls, local, advance } = world([tokens("a1", "r1"), tokens("a2", "r2")]);
    await auth.signIn();
    advance(3600 * 1000);

    expect(await auth.token()).toBe("a2");
    expect(calls[1]?.body).toEqual({
      grant_type: "refresh_token",
      refresh_token: "r1",
      client_id: "ext_client",
    });
    expect(local.data[SESSION_KEY]).toEqual({ refreshToken: "r2", clientId: "ext_client" });
  });

  it("shares one refresh between concurrent callers", async () => {
    const { auth, calls, advance } = world([tokens("a1", "r1"), tokens("a2", "r2")]);
    await auth.signIn();
    advance(3600 * 1000);

    const [first, second] = await Promise.all([auth.token(), auth.token()]);
    expect([first, second]).toEqual(["a2", "a2"]);
    expect(calls).toHaveLength(2);
  });

  it("ends the session when the gateway refuses the refresh token", async () => {
    const { auth, local, advance } = world([
      tokens("a1", "r1"),
      () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    ]);
    await auth.signIn();
    advance(3600 * 1000);

    expect(await auth.token()).toBeNull();
    expect(local.data[SESSION_KEY]).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it("keeps the session through a gateway that is only unavailable", async () => {
    const { auth, advance } = world([tokens("a1", "r1"), () => new Response("", { status: 503 })]);
    await auth.signIn();
    advance(3600 * 1000);

    await expect(auth.token()).rejects.toThrow("503");
    expect(await auth.isSignedIn()).toBe(true);
  });
});

describe("extension sign-out", () => {
  it("forgets the session and revokes the refresh token on the gateway", async () => {
    const { auth, calls, local, session } = world([
      tokens("a1", "r1"),
      () => new Response("", { status: 200 }),
    ]);
    await auth.signIn();
    await auth.signOut();

    expect(local.data[SESSION_KEY]).toBeUndefined();
    expect(Object.keys(session.data)).toEqual([]);
    expect(calls[1]).toEqual({
      url: `${GATEWAY}/oauth/token`,
      body: { token: "r1", token_type_hint: "refresh_token", client_id: "ext_client" },
    });
  });
});

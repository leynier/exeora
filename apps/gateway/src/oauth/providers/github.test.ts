import { afterEach, describe, expect, it, vi } from "vitest";
import { github } from "./github.js";
import { UpstreamAuthError } from "./types.js";

const env = {
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "secret",
} as Env;

function mockFetch(responses: Record<string, { status?: number; body: unknown }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const match = Object.keys(responses).find((key) => url.startsWith(key));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    // biome-ignore lint/style/noNonNullAssertion: key came from the same object
    const { status = 200, body } = responses[match]!;
    return new Response(JSON.stringify(body), { status });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("isConfigured", () => {
  it("is false when secrets are missing, so the provider can be hidden", () => {
    expect(github.isConfigured({} as Env)).toBe(false);
    expect(github.isConfigured({ GITHUB_CLIENT_ID: "cid" } as Env)).toBe(false);
    expect(github.isConfigured(env)).toBe(true);
  });
});

describe("authorizeUrl", () => {
  it("requests user:email, without which a private-email account cannot sign in", () => {
    const url = new URL(
      github.authorizeUrl(env, { redirectUri: "https://exeora.dev/cb", state: "req_1" }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBe("req_1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://exeora.dev/cb");
  });
});

describe("exchangeCode", () => {
  it("returns the access token", async () => {
    mockFetch({ "https://github.com/login/oauth/access_token": { body: { access_token: "tok" } } });
    await expect(github.exchangeCode(env, { code: "c", redirectUri: "r" })).resolves.toBe("tok");
  });

  it("throws on GitHub's 200-with-error response rather than returning undefined", async () => {
    mockFetch({
      "https://github.com/login/oauth/access_token": {
        body: { error: "bad_verification_code", error_description: "The code is incorrect." },
      },
    });
    await expect(github.exchangeCode(env, { code: "c", redirectUri: "r" })).rejects.toThrow(
      UpstreamAuthError,
    );
  });
});

describe("fetchIdentity", () => {
  it("keys off the numeric id, not the login, which users can change", async () => {
    mockFetch({
      "https://api.github.com/user": {
        body: { id: 42, login: "leynier", name: "Leynier", email: "l@x.dev", avatar_url: "a.png" },
      },
    });
    await expect(github.fetchIdentity("tok")).resolves.toEqual({
      providerUserId: "42",
      email: "l@x.dev",
      name: "Leynier",
      avatarUrl: "a.png",
    });
  });

  it("falls back to /user/emails when the profile email is private", async () => {
    mockFetch({
      "https://api.github.com/user/emails": {
        body: [
          { email: "old@x.dev", primary: false, verified: true },
          { email: "primary@x.dev", primary: true, verified: true },
        ],
      },
      "https://api.github.com/user": { body: { id: 7, login: "l", name: null, email: null } },
    });
    const identity = await github.fetchIdentity("tok");
    expect(identity.email).toBe("primary@x.dev");
    // Falls back to the login so the dashboard never shows a blank name.
    expect(identity.name).toBe("l");
  });

  it("refuses an unverified email rather than trusting it", async () => {
    mockFetch({
      "https://api.github.com/user/emails": {
        body: [{ email: "spoof@x.dev", primary: true, verified: false }],
      },
      "https://api.github.com/user": { body: { id: 7, login: "l", name: null, email: null } },
    });
    await expect(github.fetchIdentity("tok")).rejects.toThrow(UpstreamAuthError);
  });
});

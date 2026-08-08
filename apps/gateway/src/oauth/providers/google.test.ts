import { afterEach, describe, expect, it, vi } from "vitest";
import { google } from "./google.js";
import { UpstreamAuthError } from "./types.js";

const env = {
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "secret",
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
  it("is false until both credentials are present", () => {
    expect(google.isConfigured({} as Env)).toBe(false);
    expect(google.isConfigured({ GOOGLE_CLIENT_ID: "cid" } as Env)).toBe(false);
    expect(google.isConfigured(env)).toBe(true);
  });
});

describe("authorizeUrl", () => {
  it("requests only the identity scopes and preserves the redirect and state", () => {
    const url = new URL(
      google.authorizeUrl(env, { redirectUri: "https://exeora.dev/cb", state: "req_1" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("req_1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://exeora.dev/cb");
  });
});

describe("exchangeCode", () => {
  it("returns the access token without requesting offline access", async () => {
    const fetch = mockFetch({
      "https://oauth2.googleapis.com/token": { body: { access_token: "tok" } },
    });
    await expect(google.exchangeCode(env, { code: "c", redirectUri: "r" })).resolves.toBe("tok");
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).not.toContain("access_type");
  });

  it("throws when Google rejects the exchange", async () => {
    mockFetch({ "https://oauth2.googleapis.com/token": { status: 400, body: {} } });
    await expect(google.exchangeCode(env, { code: "c", redirectUri: "r" })).rejects.toThrow(
      UpstreamAuthError,
    );
  });
});

describe("fetchIdentity", () => {
  it("uses Google's stable subject and verified profile", async () => {
    mockFetch({
      "https://openidconnect.googleapis.com/v1/userinfo": {
        body: {
          sub: "google-42",
          email: "person@example.com",
          email_verified: true,
          name: "Person",
          picture: "avatar.png",
        },
      },
    });
    await expect(google.fetchIdentity("tok")).resolves.toEqual({
      providerUserId: "google-42",
      email: "person@example.com",
      name: "Person",
      avatarUrl: "avatar.png",
    });
  });

  it("refuses an unverified email", async () => {
    mockFetch({
      "https://openidconnect.googleapis.com/v1/userinfo": {
        body: { sub: "google-7", email: "person@example.com", email_verified: false },
      },
    });
    await expect(google.fetchIdentity("tok")).rejects.toThrow(UpstreamAuthError);
  });
});

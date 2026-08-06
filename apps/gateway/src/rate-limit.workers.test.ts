import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "./index.js";
import {
  callerAddress,
  isRateLimitedAuthPath,
  limiterFor,
  tooManyRequests,
  withinLimit,
} from "./rate-limit.js";

/**
 * The limits, and the one thing about them that is easy to get wrong.
 *
 * `/oauth/token` and `/oauth/register` are answered by the OAuth provider
 * itself, before either of the Worker's own handlers runs. A limit placed
 * anywhere inside them would never fire, so the test that matters is that a
 * request to those paths is turned away by the outermost layer.
 */

/** A limiter with a fixed verdict, so the assertion is about the wiring. */
const limiter = (success: boolean): RateLimit => ({ limit: async () => ({ success }) });

/**
 * The test bindings as the Worker's own `Env`. Cast because `OAUTH_PROVIDER` is
 * injected by the provider at runtime and so is absent from the generated type
 * the pool hands tests, which is the same reason the API tests cast.
 */
const withLimiter = (verdict: boolean) => ({ ...env, RL_AUTH: limiter(verdict) }) as unknown as Env;

const post = (path: string) =>
  new Request(`https://exeora.dev${path}`, {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.7" },
  });

describe("the wrapper in front of the OAuth provider", () => {
  it("turns away a caller hammering the token endpoint", async () => {
    const response = await worker.fetch(
      post("/oauth/token"),
      withLimiter(false),
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("limits dynamic client registration on the same key", async () => {
    const response = await worker.fetch(
      post("/oauth/register"),
      withLimiter(false),
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
  });

  it("lets the request through to the provider when the limit is not hit", async () => {
    const response = await worker.fetch(
      post("/oauth/token"),
      withLimiter(true),
      createExecutionContext(),
    );

    // Whatever the provider makes of an empty token request, it is its answer
    // and not ours. Only that we did not intercept it matters here.
    expect(response.status).not.toBe(429);
  });

  it("does not limit the sign-in screen, which a person navigates to", async () => {
    // Rate limiting a browser navigation would let someone lock themselves out
    // of a consent flow by clicking back and forth.
    expect(isRateLimitedAuthPath("/oauth/authorize")).toBe(false);
    expect(isRateLimitedAuthPath("/oauth/token")).toBe(true);
    expect(isRateLimitedAuthPath("/oauth/register")).toBe(true);
  });
});

describe("which authenticated requests are counted", () => {
  it("counts tool calls and account writes", () => {
    expect(limiterFor(env, "POST", "/p/prj_1/mcp")).toBe(env.RL_MCP);
    expect(limiterFor(env, "POST", "/api/devices")).toBe(env.RL_WRITE);
    expect(limiterFor(env, "POST", "/api/projects")).toBe(env.RL_WRITE);
  });

  it("leaves reads alone, because the dashboard polls three of them", () => {
    // Every fifteen seconds, from an open tab, without anyone touching it.
    expect(limiterFor(env, "GET", "/api/devices")).toBeUndefined();
    expect(limiterFor(env, "GET", "/api/clients")).toBeUndefined();
    expect(limiterFor(env, "GET", "/api/tool-calls")).toBeUndefined();
    expect(limiterFor(env, "DELETE", "/api/devices/dev_1")).toBeUndefined();
  });
});

describe("keying", () => {
  it("uses the edge's address header, which a client cannot forge", () => {
    expect(callerAddress(post("/oauth/token"))).toBe("203.0.113.7");
  });

  it("puts every unidentifiable caller in one bucket rather than none", () => {
    // The alternative would let anyone opt out of the limit by arriving
    // without the header.
    expect(callerAddress(new Request("https://exeora.dev/oauth/token"))).toBe("unknown");
  });
});

describe("failing open", () => {
  it("allows the request when the limiter itself breaks", async () => {
    const broken: RateLimit = {
      limit: async () => {
        throw new Error("the limiter is down");
      },
    };

    expect(await withinLimit(broken, "usr_1")).toBe(true);
  });

  it("allows the request when no limiter is bound at all", async () => {
    expect(await withinLimit(undefined, "usr_1")).toBe(true);
  });
});

describe("the answer itself", () => {
  it("says how long to wait, in a body every kind of client can read", async () => {
    const response = tooManyRequests();

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toContain("Too many requests");
  });
});

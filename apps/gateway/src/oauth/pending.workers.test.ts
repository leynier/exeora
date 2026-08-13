import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { claimAuthorization, parkAuthorization, peekAuthorization } from "./pending.js";

const authRequest = {
  responseType: "code",
  clientId: "client",
  redirectUri: "https://client.example/callback",
  scope: ["tools:read"],
  state: "client-state",
};

describe("pending OAuth authorization", () => {
  it("can be peeked without consuming it", async () => {
    const state = await parkAuthorization(env as Env, { authRequest });
    expect(await peekAuthorization(env as Env, state)).toEqual({ authRequest });
    expect(await peekAuthorization(env as Env, state)).toEqual({ authRequest });
  });

  it("can be claimed exactly once under concurrency", async () => {
    const state = await parkAuthorization(env as Env, { authRequest });
    const claimed = await Promise.all([
      claimAuthorization(env as Env, state),
      claimAuthorization(env as Env, state),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await claimAuthorization(env as Env, state)).toBeNull();
  });

  it("does not return an expired row", async () => {
    const state = await parkAuthorization(env as Env, { authRequest });
    await env.DB.prepare("UPDATE oauth_pending SET expires_at = 0 WHERE state = ?1")
      .bind(state)
      .run();
    expect(await peekAuthorization(env as Env, state)).toBeNull();
    expect(await claimAuthorization(env as Env, state)).toBeNull();
  });
});

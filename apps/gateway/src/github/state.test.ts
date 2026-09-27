import { describe, expect, it } from "vitest";
import { consumeConnectState, signConnectState, verifyConnectState } from "./state.js";

const env = { REQUEST_STATE_SECRET: "request-state-secret-for-tests-32-bytes" };

/** A KV that remembers what it was told to, and for how long. */
function kv() {
  const kept = new Map<string, { value: string; seconds: number | undefined }>();
  const namespace = {
    get: async (key: string) => kept.get(key)?.value ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      kept.set(key, { value, seconds: options?.expirationTtl });
    },
  };
  return { kept, env: { OAUTH_KV: namespace as unknown as KVNamespace } };
}

describe("the state that travels to GitHub and back", () => {
  it("names the account it was signed for", async () => {
    const now = Date.UTC(2026, 8, 26);
    const state = await signConnectState(env, "usr_state", now);
    expect(await verifyConnectState(env, state, now)).toEqual({
      userId: "usr_state",
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      expiresAt: now + 10 * 60_000,
    });
    // Two of them are never the same string, even in the same millisecond.
    expect(await signConnectState(env, "usr_state", 1)).not.toBe(
      await signConnectState(env, "usr_state", 1),
    );
  });

  it("stops being accepted after ten minutes", async () => {
    const now = Date.UTC(2026, 8, 26);
    const state = await signConnectState(env, "usr_state", now);
    expect(await verifyConnectState(env, state, now + 9 * 60_000)).toMatchObject({
      userId: "usr_state",
    });
    expect(await verifyConnectState(env, state, now + 10 * 60_000)).toBeNull();
  });

  it("refuses one that was altered, forged or signed under another key", async () => {
    const state = await signConnectState(env, "usr_state");
    const [payload = "", signature = ""] = state.split(".");
    const other = btoa(
      JSON.stringify({ u: "usr_victim", e: Date.now() + 60_000, n: "abcdefgh12345678" }),
    )
      .replaceAll("=", "")
      .replaceAll("+", "-")
      .replaceAll("/", "_");

    expect(await verifyConnectState(env, `${other}.${signature}`)).toBeNull();
    expect(await verifyConnectState(env, `${payload}.${signature.slice(0, -2)}AA`)).toBeNull();
    expect(await verifyConnectState(env, payload)).toBeNull();
    expect(await verifyConnectState(env, `${state}.extra`)).toBeNull();
    expect(await verifyConnectState(env, "")).toBeNull();
    expect(await verifyConnectState(env, undefined)).toBeNull();
    expect(
      await verifyConnectState(
        { REQUEST_STATE_SECRET: "another-secret-of-thirty-two-bytes!" },
        state,
      ),
    ).toBeNull();
  });

  it("is not signed at all without a secret", async () => {
    await expect(signConnectState({ REQUEST_STATE_SECRET: "" }, "usr_state")).rejects.toThrow();
  });

  it("is good once", async () => {
    const now = Date.UTC(2026, 8, 26);
    const store = kv();
    const first = await verifyConnectState(env, await signConnectState(env, "usr_state", now), now);
    const second = await verifyConnectState(
      env,
      await signConnectState(env, "usr_state", now),
      now,
    );
    if (!first || !second) throw new Error("The states did not verify.");

    expect(await consumeConnectState(store.env, first, now)).toBe(true);
    expect(await consumeConnectState(store.env, first, now)).toBe(false);
    expect(await consumeConnectState(store.env, first, now + 5 * 60_000)).toBe(false);
    // Another state of the same account is another state.
    expect(await consumeConnectState(store.env, second, now + 9.5 * 60_000)).toBe(true);

    // Remembered for as long as the state would have been accepted, and
    // never for less than KV will keep anything.
    expect([...store.kept.values()].map((entry) => entry.seconds)).toEqual([600, 60]);
  });
});

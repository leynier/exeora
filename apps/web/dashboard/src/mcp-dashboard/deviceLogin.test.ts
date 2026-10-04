import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../mcp-panel/sandbox.js";
import { CALLBACK_PATH, deviceLogin } from "./deviceLogin.js";
import { createSession } from "./session.js";

const GATEWAY = "https://exeora.dev";

type Answer = { status?: number; json: unknown };

/** A gateway that answers each path in turn, and remembers what it was sent. */
function gateway(answers: Record<string, Answer[]>) {
  const sent: { url: string; body: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const body = init?.body ? Object.fromEntries(init.body as URLSearchParams) : {};
    sent.push({ url: href, body });
    const path = new URL(href).pathname;
    const answer = answers[path]?.shift();
    if (!answer) throw new Error(`unexpected ${href}`);
    return new Response(JSON.stringify(answer.json), { status: answer.status ?? 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const DEVICE = {
  device_code: "dev-1",
  user_code: "ABCD-EFGH",
  verification_uri: `${GATEWAY}/oauth/device`,
  expires_in: 600,
  interval: 5,
};
const AUTHORIZED = {
  authorization_code: "code-1",
  redirect_uri: `${GATEWAY}${CALLBACK_PATH}`,
  iss: GATEWAY,
};

function flow(answers: Record<string, Answer[]>, signal = new AbortController().signal) {
  const { fetch, sent } = gateway(answers);
  const sleeps: number[] = [];
  let clock = 0;
  const onCode = vi.fn();
  const run = deviceLogin(
    {
      gateway: GATEWAY,
      fetch,
      signal,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      random: (bytes) => new Uint8Array(bytes).fill(7),
    },
    onCode,
  );
  return { run, sent, sleeps, onCode };
}

describe("deviceLogin", () => {
  it("shows the code, polls at the interval, and redeems with PKCE on the gateway", async () => {
    const { run, sent, sleeps, onCode } = flow({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: DEVICE }],
      "/oauth/device/token": [
        { status: 400, json: { error: "authorization_pending" } },
        { status: 400, json: { error: "slow_down" } },
        { json: AUTHORIZED },
      ],
      "/oauth/token": [{ json: { access_token: "tok", expires_in: 3600 } }],
    });

    expect(await run).toEqual({ accessToken: "tok", expiresIn: 3600 });
    expect(onCode).toHaveBeenCalledWith({
      userCode: "ABCD-EFGH",
      verificationUri: `${GATEWAY}/oauth/device`,
      expiresAt: 600_000,
    });
    expect(sleeps).toEqual([5000, 5000, 10000]);
    const start = sent.find((item) => item.url.endsWith("/oauth/device/code"));
    expect(start?.body).toMatchObject({
      client_id: "sideapp",
      code_challenge_method: "S256",
      scope: "dashboard:manage",
    });
    const exchange = sent.find((item) => item.url === `${GATEWAY}/oauth/token`);
    expect(exchange?.body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "sideapp",
      code: "code-1",
      redirect_uri: `${GATEWAY}${CALLBACK_PATH}`,
    });
    expect(exchange?.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    // Every request went to the gateway the page came from.
    expect(sent.every((item) => item.url.startsWith(`${GATEWAY}/oauth/`))).toBe(true);
  });

  it.each([
    [{ ...AUTHORIZED, iss: "https://evil.example" }, "another issuer"],
    [{ ...AUTHORIZED, redirect_uri: "https://evil.example/cb" }, "another redirect"],
    [{ ...AUTHORIZED, redirect_uri: `${GATEWAY}/oauth/device/callback` }, "another redirect"],
  ])("refuses an approval naming somewhere else (%j)", async (authorized, message) => {
    const { run, sent } = flow({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: DEVICE }],
      "/oauth/device/token": [{ json: authorized }],
    });
    await expect(run).rejects.toThrow(message);
    expect(sent.some((item) => item.url.endsWith("/oauth/token"))).toBe(false);
  });

  it("refuses a sign-in page on another origin, before showing any code", async () => {
    const { run, onCode } = flow({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: { ...DEVICE, verification_uri: "https://evil.example/x" } }],
    });
    await expect(run).rejects.toThrow("sign-in page elsewhere");
    expect(onCode).not.toHaveBeenCalled();
  });

  it.each([
    ["access_denied", "declined"],
    ["expired_token", "expired"],
  ])("says so when the poll answers %s", async (error, message) => {
    const { run } = flow({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: DEVICE }],
      "/oauth/device/token": [{ status: 400, json: { error } }],
    });
    await expect(run).rejects.toThrow(message);
  });

  it("gives up when the code runs out, without polling past it", async () => {
    const { run, sleeps } = flow({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: { ...DEVICE, expires_in: 12 } }],
      "/oauth/device/token": [
        { status: 400, json: { error: "authorization_pending" } },
        { status: 400, json: { error: "authorization_pending" } },
      ],
    });
    await expect(run).rejects.toThrow("expired");
    expect(sleeps).toEqual([5000, 5000]);
  });
});

describe("createSession", () => {
  it("keeps a token until it nearly expires", () => {
    let clock = 0;
    const session = createSession(memoryStorage(), () => clock);
    expect(session.save("tok", 120, session.generation())).toBe(true);
    expect(session.token()).toBe("tok");
    clock = 61_000;
    expect(session.token()).toBeNull();
  });

  it("signs out: aborts what was running and refuses a late sign-in", () => {
    const storage = memoryStorage();
    const session = createSession(storage);
    const listener = vi.fn();
    session.subscribe(listener);
    const started = session.generation();
    const signal = session.signal();
    session.save("tok", 3600, started);

    session.signOut();
    expect(signal.aborted).toBe(true);
    expect(session.token()).toBeNull();
    expect(storage.length).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    // A flow begun before signing out finishes late; its token is not kept.
    expect(session.save("late", 3600, started)).toBe(false);
    expect(session.token()).toBeNull();
    expect(session.signal().aborted).toBe(false);
  });
});

describe("session expiry", () => {
  afterEach(() => vi.useRealTimers());

  it("ends the generation when the token runs out, aborting what was running", () => {
    vi.useFakeTimers({ now: 0 });
    const session = createSession(memoryStorage());
    const listener = vi.fn();
    session.subscribe(listener);
    const started = session.generation();
    session.save("tok", 120, started);
    const signal = session.signal();

    vi.advanceTimersByTime(59_000);
    expect(session.token()).toBe("tok");
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(session.token()).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(session.generation()).toBe(started + 1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.save("late", 3600, started)).toBe(false);
  });

  it("schedules the end of a token kept from earlier in the tab", () => {
    vi.useFakeTimers({ now: 0 });
    const storage = memoryStorage();
    storage.setItem("exeora.sideapp.access_token", "kept");
    storage.setItem("exeora.sideapp.expires_at", String(90_000));
    const session = createSession(storage);
    expect(session.token()).toBe("kept");
    vi.advanceTimersByTime(30_000);
    expect(session.generation()).toBe(1);
    expect(storage.length).toBe(0);
  });

  it("works on storage that refuses, without keeping anything", () => {
    const refusing = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as Storage;
    const session = createSession(refusing);
    expect(session.token()).toBeNull();
    expect(session.save("tok", 3600, session.generation())).toBe(false);
    expect(() => session.signOut()).not.toThrow();
  });

  it("stops polling the moment the session ends", async () => {
    const session = createSession(memoryStorage());
    const { fetch } = gateway({
      "/oauth/sideapp-client": [{ json: { client_id: "sideapp" } }],
      "/oauth/device/code": [{ json: DEVICE }],
    });
    const run = deviceLogin({ gateway: GATEWAY, fetch, signal: session.signal() }, () =>
      session.signOut(),
    );
    await expect(run).rejects.toBeDefined();
    expect(vi.mocked(fetch).mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/oauth/sideapp-client",
      "/oauth/device/code",
    ]);
  });
});

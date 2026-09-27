import { createExecutionContext, env } from "cloudflare:test";
import { Hono } from "hono";
import { vi } from "vitest";
import { api } from "../api/index.js";
import { setSession } from "../oauth/session.js";
import { base64Url, forgetInstallationTokens } from "./app.js";
import { type GrantedTokens, storeUserTokens } from "./user-token.js";

/**
 * What the GitHub tests share: an app with a key made for the occasion, a
 * GitHub that answers from a function, and a caller that stands in for the
 * OAuth provider.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
 */

export const APP_ID = "424242";
export const APP_SLUG = "exeora-test";
export const WEBHOOK_SECRET = "webhook-secret-that-is-not-real";

export interface TestKey {
  /** As WebCrypto exports it. */
  pkcs8: Uint8Array;
  pkcs8Pem: string;
  /** The same key as GitHub would have it downloaded. */
  pkcs1: Uint8Array;
  pkcs1Pem: string;
  publicKey: CryptoKey;
}

let generated: Promise<TestKey> | undefined;

/** One key for the whole file: making one is the slowest thing these tests do. */
export function testKey(): Promise<TestKey> {
  generated ??= generate();
  return generated;
}

async function generate(): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  // Past the envelope: a sequence header, the version, the algorithm, and
  // the header of the octet string that holds the PKCS#1 key.
  const envelope = 4 + 3 + 15;
  if (pkcs8[envelope] !== 0x04 || pkcs8[envelope + 1] !== 0x82) {
    throw new Error("The exported key is not laid out the way this fixture reads it.");
  }
  const pkcs1 = pkcs8.slice(envelope + 4);
  return {
    pkcs8,
    pkcs8Pem: pem("PRIVATE KEY", pkcs8),
    pkcs1,
    pkcs1Pem: pem("RSA PRIVATE KEY", pkcs1),
    publicKey: pair.publicKey,
  };
}

function pem(label: string, der: Uint8Array): string {
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** The bindings of a gateway whose connection to GitHub is on. */
export async function githubOn() {
  return {
    GITHUB_APP_ID: APP_ID,
    GITHUB_APP_SLUG: APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: (await testKey()).pkcs8Pem,
    GITHUB_APP_CLIENT_ID: "Iv1.not-a-real-client",
    GITHUB_APP_CLIENT_SECRET: "client-secret-that-is-not-real",
    GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CLOUD_CREDENTIALS_KEY,
    REQUEST_STATE_SECRET: "request-state-secret-for-tests-32-bytes",
    COOKIE_SECRET: "cookie-secret-for-tests-that-is-not-real",
  };
}

/** The key the tokens of people are kept under in these tests. */
export const CLOUD_CREDENTIALS_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * The same gateway with the connection off. Set to undefined rather than
 * left out, so a `.dev.vars` that holds a real app cannot switch it on.
 */
export const GITHUB_OFF = {
  GITHUB_APP_ID: undefined,
  GITHUB_APP_SLUG: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_APP_CLIENT_ID: undefined,
  GITHUB_APP_CLIENT_SECRET: undefined,
  GITHUB_APP_WEBHOOK_SECRET: undefined,
};

/**
 * The Worker's own `Env`, secrets included. The type the pool hands tests is
 * the generated one, which knows the bindings of wrangler.jsonc and none of
 * the secrets `env.ts` adds.
 */
export type TestEnv = Env;

export async function envOn(extra: Record<string, unknown> = {}): Promise<TestEnv> {
  forgetInstallationTokens();
  return { ...env, ...(await githubOn()), ...extra } as unknown as TestEnv;
}

export function envOff(): TestEnv {
  return { ...env, ...GITHUB_OFF } as unknown as TestEnv;
}

export interface Asked {
  method: string;
  url: string;
  headers: Headers;
  /** The body as JSON, or undefined for a request without one. */
  body: unknown;
}

/**
 * A GitHub that answers from `handler` and remembers what it was asked.
 * Anything the handler leaves unanswered is a 404, as it would be there.
 */
export function fakeGitHub(
  handler: (asked: Asked) => Response | undefined | Promise<Response | undefined>,
) {
  const asked: Asked[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const entry: Asked = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: text === "" ? undefined : JSON.parse(text),
    };
    asked.push(entry);
    return (await handler(entry)) ?? Response.json({ message: "Not Found" }, { status: 404 });
  });
  return { fetcher, asked };
}

/** What GitHub answers a request for an installation token with. */
export function minted(token = "ghs_installation_token", livesMs = 60 * 60_000): Response {
  return Response.json(
    { token, expires_at: new Date(Date.now() + livesMs).toISOString() },
    { status: 201 },
  );
}

export const isTokenRequest = (asked: Asked, installationId?: number) =>
  asked.method === "POST" &&
  new RegExp(`/app/installations/${installationId ?? "\\d+"}/access_tokens$`).test(asked.url);

export function repository(id: number, fullName: string, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split("/");
  return {
    id,
    name,
    full_name: fullName,
    private: false,
    owner: { login: owner },
    default_branch: "main",
    clone_url: `https://github.com/${fullName}.git`,
    description: null,
    pushed_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

/** `X-Hub-Signature-256` for a body, as GitHub computes it. */
export async function signature(body: string, secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const CLI = ["executor:connect", "executor:execute"];
export const DASHBOARD = ["dashboard:manage"];

/** A request to the API as the OAuth provider would hand it over. */
export function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    userId: string;
    scopes?: string[];
    /** Set for a cloud machine's token. */
    deviceId?: string;
    env: TestEnv;
  },
) {
  const context = createExecutionContext();
  (context as { props?: Record<string, unknown> }).props = {
    userId: options.userId,
    scopes: options.scopes ?? DASHBOARD,
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
  };
  return api.fetch(
    new Request(`https://exeora.dev${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      ...(options.body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(options.body),
          }),
    }),
    options.env,
    context,
  );
}

/** The token GitHub knows a person of these tests by. */
export const tokenOf = (userId: string) => `ghu_${userId}`;

/**
 * Connects an account as far as the database goes: the token it would have
 * been granted, kept the way a connection keeps it.
 */
export async function authorize(
  userId: string,
  granted: Partial<GrantedTokens> & { now?: number } = {},
): Promise<void> {
  await storeUserTokens(
    env,
    { credentialsKey: CLOUD_CREDENTIALS_KEY },
    userId,
    "octocat",
    {
      accessToken: granted.accessToken ?? tokenOf(userId),
      expiresIn: granted.expiresIn ?? null,
      refreshToken: granted.refreshToken ?? null,
    },
    granted.now,
  );
}

/** The `Cookie` header of a browser signed in to Exeora as `userId`. */
export async function sessionCookie(userId: string, testEnv: TestEnv): Promise<string> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/", async (c) => {
    await setSession(c, userId);
    return c.body(null, 204);
  });
  const response = await app.fetch(new Request("https://exeora.dev/"), testEnv);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

export interface World {
  /** What each installation was given. */
  installations: Record<number, ReturnType<typeof repository>[]>;
  /**
   * What each person can do, by their token and the repository's id. A
   * repository that is not named is one that person cannot see.
   */
  people: Record<string, Record<number, { push: boolean }>>;
}

/**
 * A GitHub with installations and people in it, which answers each as
 * GitHub does: an installation's token for what the installation holds, a
 * person's token for what that person can open. `first` answers before it,
 * for whatever a test wants said differently.
 */
export function githubWorld(
  world: World,
  first?: (asked: Asked) => Response | undefined | Promise<Response | undefined>,
) {
  let count = 0;
  const installationOf = new Map<string, number>();
  return fakeGitHub(async (asked) => {
    const earlier = await first?.(asked);
    if (earlier) return earlier;

    const url = new URL(asked.url);
    const bearer = asked.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (asked.method === "POST" && mint) {
      const held = world.installations[Number(mint[1])];
      if (!held) return Response.json({ message: "Not Found" }, { status: 404 });
      const { repository_ids: ids } = (asked.body ?? {}) as { repository_ids?: number[] };
      if (ids?.some((id) => !held.some((entry) => entry.id === id))) {
        return Response.json({ message: "not in this installation" }, { status: 422 });
      }
      count += 1;
      const token = `ghs_${mint[1]}_${count}`;
      installationOf.set(token, Number(mint[1]));
      return minted(token);
    }

    const person = world.people[bearer];
    const listing = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (listing) {
      if (!person) return Response.json({ message: "Bad credentials" }, { status: 401 });
      const held = world.installations[Number(listing[1])];
      if (!held) return Response.json({ message: "Not Found" }, { status: 404 });
      const visible = held
        .filter((entry) => person[entry.id])
        .map((entry) => ({
          ...entry,
          permissions: { pull: true, push: person[entry.id]?.push === true },
        }));
      const page = Number(url.searchParams.get("page") ?? "1");
      return Response.json({
        total_count: visible.length,
        repositories: visible.slice((page - 1) * 100, page * 100),
      });
    }

    const one = /^\/repositories\/(\d+)$/.exec(url.pathname);
    if (one) {
      const id = Number(one[1]);
      const installation = installationOf.get(bearer);
      if (installation !== undefined) {
        const found = world.installations[installation]?.find((entry) => entry.id === id);
        return found ? Response.json(found) : undefined;
      }
      if (!bearer.startsWith("ghu_")) return undefined;
      if (!person) return Response.json({ message: "Bad credentials" }, { status: 401 });
      const found = Object.values(world.installations)
        .flat()
        .find((entry) => entry.id === id);
      if (!found || !person[id]) return undefined;
      return Response.json({
        ...found,
        permissions: { pull: true, push: person[id]?.push === true },
      });
    }
    return undefined;
  });
}

export { base64Url };

import { createExecutionContext, env } from "cloudflare:test";
import {
  decodeRelayMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type WorkspaceValue,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { api } from "../api/index.js";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";

/**
 * What the AI tests share: a gateway with the feature on, a provider that
 * answers from a function, a caller that stands in for the OAuth provider,
 * and a machine that answers workspace calls.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
 */

/** The key every credential is kept under in these tests: the pool's `CLOUD_CREDENTIALS_KEY`. */
export const CREDENTIALS_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export type TestEnv = Env;

/** AI Assist on, with both providers and xAI's device login. The audit goes to the outbox, where a test can read it. */
export function aiOn(extra: Record<string, unknown> = {}): TestEnv {
  return {
    ...env,
    AI_ASSIST_PROVIDERS: "openai,xai",
    XAI_OAUTH_CLIENT_ID: "xai-client-for-tests",
    AI_ASSIST_OAUTH: undefined,
    AUDIT_STREAM: undefined,
    ...extra,
  } as unknown as TestEnv;
}

/** Set to undefined rather than left out, so a `.dev.vars` cannot switch it on. */
export function aiOff(): TestEnv {
  return { ...env, AI_ASSIST_PROVIDERS: undefined, AUDIT_STREAM: undefined } as unknown as TestEnv;
}

export interface Asked {
  method: string;
  url: string;
  headers: Headers;
  /** How a redirect would be handled, which every provider request says. */
  redirect: Request["redirect"];
  text: string;
  json(): unknown;
  form(): URLSearchParams;
}

/**
 * A provider that answers from `handler` and remembers what it was asked.
 * Anything the handler leaves unanswered is a 404.
 */
export function fakeProvider(
  handler: (asked: Asked) => Response | undefined | Promise<Response | undefined>,
) {
  const asked: Asked[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    // Bytes rather than `.text()`: workerd warns about reading a form body as text.
    const text = new TextDecoder().decode(await request.arrayBuffer());
    const entry: Asked = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      redirect: request.redirect,
      text,
      json: () => JSON.parse(text),
      form: () => new URLSearchParams(text),
    };
    asked.push(entry);
    return (await handler(entry)) ?? Response.json({ error: "not found" }, { status: 404 });
  });
  return { fetcher, asked };
}

/** An unsigned JWT carrying these claims, which is all the gateway reads of one. */
export function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

/** A request to the API as the OAuth provider would hand it over. */
export function call(
  path: string,
  options: { method?: string; body?: unknown; userId: string; env: TestEnv },
) {
  const context = createExecutionContext();
  (context as { props?: Record<string, unknown> }).props = {
    userId: options.userId,
    scopes: ["dashboard:manage"],
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

/** A fresh account, with its previous incarnation and everything hanging off it gone. */
export async function seedUser(userId: string): Promise<void> {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, userId)).run();
  await database
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@example.com` })
    .run();
}

/**
 * A CLI on the machine, announcing Source Control v2 and answering every
 * workspace call with what `respond` says. Resolves once the relay has
 * acknowledged it, so a route called next finds the machine online.
 */
export async function attachMachine(
  userId: string,
  deviceId: string,
  projectId: string,
  respond: (action: unknown) => WorkspaceValue,
) {
  const response = await env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).fetch(
    new Request(`https://relay/connect?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const seen: unknown[] = [];
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "hello.ack") resolve();
      if (message?.type === "workspace.call") {
        seen.push(message.action);
        socket.send(
          encodeMessage({
            type: "workspace.result",
            requestId: message.requestId,
            durationMs: 1,
            result: { ok: true, value: respond(message.action) },
          }),
        );
      }
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId,
      cliVersion: "0.1.0",
      platform: "linux",
      projects: [{ id: projectId, slug: "project" }],
      capabilities: {
        prompt: false,
        tools: ["read_file"],
        features: ["source-control-v1", "source-control-v2"],
        workspaceRouting: true,
      },
    }),
  );
  await acknowledged;
  return { socket, seen, close: () => socket.close(1000, "done") };
}

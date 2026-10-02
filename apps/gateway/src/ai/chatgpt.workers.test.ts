import { env } from "cloudflare:test";
import {
  decodeRelayMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type WorkspaceValue,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import { aiOn, CREDENTIALS_KEY, call, seedUser } from "./fixtures.js";

const OWNER = "usr_chatgpt_gateway";
const OTHER = "usr_chatgpt_other";
const DEVICE = "dev_chatgpt_gateway";
const PROJECT = "prj_chatgpt_gateway";

const on = (extra: Record<string, unknown> = {}) =>
  aiOn({
    AI_ASSIST_PROVIDERS: "openai,xai,chatgpt",
    CLOUD_CREDENTIALS_KEY: CREDENTIALS_KEY,
    ...extra,
  });

const STAGED: WorkspaceValue = {
  kind: "staged_context",
  branch: "feature/chatgpt",
  files: [{ path: "src/login.ts", status: "A", additions: 4, deletions: 0, binary: false }],
  patch: "+export function login() {}",
  truncated: false,
};

const STATUS: WorkspaceValue = {
  kind: "chatgpt_status",
  state: "ready",
  account: {
    label: "Person",
    email: "person@example.com",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    planUsage: true,
    newRegistration: false,
  },
};

async function connectMachine(
  respond: (action: unknown) => WorkspaceValue,
  features = ["source-control-v2", "chatgpt-v1"],
) {
  const response = await env.DEVICE_RELAY.getByName(relayName(OWNER, DEVICE)).fetch(
    new Request(`https://relay/connect?deviceId=${DEVICE}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const seen: unknown[] = [];
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "hello.ack") resolve();
      if (message?.type !== "workspace.call") return;
      seen.push(message.action);
      socket.send(
        encodeMessage({
          type: "workspace.result",
          requestId: message.requestId,
          durationMs: 1,
          result: { ok: true, value: respond(message.action) },
        }),
      );
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE,
      cliVersion: "0.20.1",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "chatgpt" }],
      capabilities: { prompt: false, tools: ["read_file"], features, workspaceRouting: true },
    }),
  );
  await acknowledged;
  return { socket, seen };
}

beforeEach(async () => {
  await seedUser(OWNER);
  await seedUser(OTHER);
  await db(env)
    .insert(schema.devices)
    .values({ id: DEVICE, userId: OWNER, name: "ChatGPT machine", platform: "linux" })
    .run();
  await db(env)
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: OWNER,
      deviceId: DEVICE,
      name: "ChatGPT project",
      slug: "chatgpt-project",
      localPath: "/work/chatgpt",
    })
    .run();
});

describe("the machine-bound ChatGPT provider", () => {
  it("is offered without a gateway credential and survives the xAI OAuth switch", async () => {
    const response = await call("/api/ai", { userId: OWNER, env: on() });
    const body = (await response.json()) as {
      providers: Array<Record<string, unknown>>;
    };
    expect(body.providers).toContainEqual({
      id: "chatgpt",
      label: "ChatGPT plan",
      authKinds: [],
      machineBound: true,
      linked: null,
      models: [],
    });

    const keysOnly = await call("/api/ai", {
      userId: OWNER,
      env: on({ AI_ASSIST_OAUTH: "off" }),
    });
    const keysBody = (await keysOnly.json()) as {
      providers: Array<{ id: string; authKinds: string[] }>;
    };
    expect(keysBody.providers.find((entry) => entry.id === "chatgpt")?.authKinds).toEqual([]);
    expect(keysBody.providers.find((entry) => entry.id === "openai")?.authKinds).toEqual([
      "api_key",
    ]);

    const keyless = await call("/api/ai", {
      userId: OWNER,
      env: on({
        AI_ASSIST_PROVIDERS: "openai,chatgpt",
        CLOUD_CREDENTIALS_KEY: undefined,
      }),
    });
    expect(keyless.status).toBe(200);
    const keylessBody = (await keyless.json()) as {
      providers: Array<{ id: string }>;
    };
    expect(keylessBody.providers.map(({ id }) => id)).toEqual(["chatgpt"]);
  });

  it("dispatches status, login and models only to the owned local machine", async () => {
    const machine = await connectMachine((action) => {
      switch ((action as { action: string }).action) {
        case "chatgpt_status":
          return STATUS;
        case "chatgpt_login_start":
          return {
            kind: "chatgpt_login",
            authorizeUrl: "https://auth.openai.com/api/accounts/authorize?state=state_1",
            expiresAt: Date.now() + 600_000,
          };
        case "chatgpt_models":
          return { kind: "chatgpt_models", models: [{ id: "gpt-local", label: "Local model" }] };
        default:
          throw new Error("unexpected action");
      }
    });

    const status = await call(`/api/devices/${DEVICE}/ai/chatgpt`, { userId: OWNER, env: on() });
    expect(await status.json()).toEqual({
      state: "ready",
      account: STATUS.kind === "chatgpt_status" ? STATUS.account : undefined,
    });

    const login = await call(`/api/devices/${DEVICE}/ai/chatgpt/login`, {
      method: "POST",
      body: { mode: "new" },
      userId: OWNER,
      env: on(),
    });
    expect(await login.json()).toMatchObject({
      authorizeUrl: "https://auth.openai.com/api/accounts/authorize?state=state_1",
    });

    const models = await call(`/api/devices/${DEVICE}/ai/chatgpt/models`, {
      userId: OWNER,
      env: on(),
    });
    expect(await models.json()).toEqual({
      models: [{ id: "gpt-local", label: "Local model" }],
    });
    const projectStatus = await call(`/api/projects/${PROJECT}/ai/chatgpt`, {
      userId: OWNER,
      env: on(),
    });
    expect(projectStatus.status).toBe(200);
    const projectModels = await call(`/api/projects/${PROJECT}/ai/chatgpt/models`, {
      userId: OWNER,
      env: on(),
    });
    expect(projectModels.status).toBe(200);
    expect(machine.seen.map((value) => (value as { action: string }).action)).toEqual([
      "chatgpt_status",
      "chatgpt_login_start",
      "chatgpt_models",
      "chatgpt_status",
      "chatgpt_models",
    ]);
    machine.socket.close(1000, "done");

    expect(
      (await call(`/api/devices/${DEVICE}/ai/chatgpt`, { userId: OTHER, env: on() })).status,
    ).toBe(404);
  });

  it("maps offline, outdated and cloud devices without dispatching plan actions", async () => {
    const offline = await call(`/api/devices/${DEVICE}/ai/chatgpt`, { userId: OWNER, env: on() });
    expect(offline.status).toBe(409);
    expect(await offline.json()).toMatchObject({ error: "ai_machine_offline" });

    const old = await connectMachine(() => STATUS, ["source-control-v2"]);
    const update = await call(`/api/devices/${DEVICE}/ai/chatgpt`, { userId: OWNER, env: on() });
    expect(update.status).toBe(409);
    expect(await update.json()).toMatchObject({ error: "ai_update_cli" });
    old.socket.close(1000, "done");

    await db(env)
      .update(schema.devices)
      .set({ kind: "cloud" })
      .where(eq(schema.devices.id, DEVICE))
      .run();
    const cloud = await call(`/api/devices/${DEVICE}/ai/chatgpt`, { userId: OWNER, env: on() });
    expect(cloud.status).toBe(409);
    expect(await cloud.json()).toMatchObject({ error: "ai_chatgpt_unavailable_on_cloud" });
  });
});

describe("ChatGPT plan generation", () => {
  it("reads context and generates on the same local machine without provider fallback", async () => {
    const machine = await connectMachine((action) => {
      const name = (action as { action: string }).action;
      if (name === "staged_context") return STAGED;
      if (name === "chatgpt_generate") {
        expect(action).not.toHaveProperty("model");
        expect(action).toMatchObject({ instructions: expect.any(String) });
        return {
          kind: "chatgpt_generation",
          outcome: "completed",
          text: "Add the login flow",
          model: "gpt-local",
        };
      }
      throw new Error(`unexpected action ${name}`);
    });
    const response = await call(`/api/projects/${PROJECT}/ai/commit-message`, {
      body: {},
      userId: OWNER,
      env: on({ AI_ASSIST_PROVIDERS: "chatgpt", CLOUD_CREDENTIALS_KEY: undefined }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Add the login flow",
      provider: "chatgpt",
      model: "gpt-local",
    });
    expect(machine.seen.map((value) => (value as { action: string }).action)).toEqual([
      "staged_context",
      "chatgpt_generate",
    ]);
    machine.socket.close(1000, "done");
  });

  it("uses a saved ChatGPT account default when all providers are offered", async () => {
    const gateway = on();
    const settings = await call("/api/ai/settings", {
      method: "PUT",
      body: { defaultProvider: "chatgpt" },
      userId: OWNER,
      env: gateway,
    });
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({ defaultProvider: "chatgpt" });
    expect(
      await db(env)
        .select()
        .from(schema.aiProviders)
        .where(eq(schema.aiProviders.userId, OWNER))
        .all(),
    ).toHaveLength(0);

    const machine = await connectMachine((action) => {
      const name = (action as { action: string }).action;
      if (name === "staged_context") return STAGED;
      if (name === "chatgpt_generate") {
        expect(action).not.toHaveProperty("model");
        return {
          kind: "chatgpt_generation",
          outcome: "completed",
          text: "Use the saved local ChatGPT default",
          model: "gpt-local",
        };
      }
      throw new Error(`unexpected action ${name}`);
    });
    const response = await call(`/api/projects/${PROJECT}/ai/commit-message`, {
      body: {},
      userId: OWNER,
      env: gateway,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Use the saved local ChatGPT default",
      provider: "chatgpt",
      model: "gpt-local",
    });
    expect(machine.seen.map((value) => (value as { action: string }).action)).toEqual([
      "staged_context",
      "chatgpt_generate",
    ]);
    machine.socket.close(1000, "done");
  });

  it("maps a usage limit with a bounded request id and no fallback", async () => {
    const machine = await connectMachine((action) => {
      const name = (action as { action: string }).action;
      if (name === "staged_context") return STAGED;
      return {
        kind: "chatgpt_generation",
        outcome: "failed",
        reason: "usage_limit",
        requestId: "req_local_1",
      };
    });
    const response = await call(`/api/projects/${PROJECT}/ai/commit-message`, {
      body: { provider: "chatgpt" },
      userId: OWNER,
      env: on(),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "ai_usage_limit",
      message: "ChatGPT usage limit reached.",
      manageUsageUrl: "https://chatgpt.com/settings/usage",
      requestId: "req_local_1",
    });
    machine.socket.close(1000, "done");
  });

  it("rejects a cloud target before reading its workspace", async () => {
    await db(env)
      .update(schema.devices)
      .set({ kind: "cloud" })
      .where(eq(schema.devices.id, DEVICE))
      .run();
    await db(env)
      .insert(schema.cloudMachines)
      .values({
        deviceId: DEVICE,
        userId: OWNER,
        projectId: PROJECT,
        spriteName: `chatgpt-${crypto.randomUUID()}`,
        status: "ready",
      })
      .run();
    const response = await call(`/api/projects/${PROJECT}/ai/commit-message`, {
      body: { provider: "chatgpt" },
      userId: OWNER,
      env: on(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ai_chatgpt_unavailable_on_cloud" });
  });
});

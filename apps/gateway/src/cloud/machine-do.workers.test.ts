import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { decodeRelayMessage, encodeMessage, PROTOCOL_VERSION } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import type { CloudRelayConfig } from "../relay-do-cloud.js";
import { cliConfigFor } from "./bootstrap.js";
import { type CloudMachine, provisionInput } from "./machine-do.js";
import { mintMachineToken } from "./machine-tokens.js";

/**
 * The provisioning object, one alarm at a time, against a Sprites API played
 * by a fetcher the test hands in.
 */

const USER = "usr_cloud_machine";
const PROJECT = "prj_cloud_machine";
let DEVICE: string;
let SPRITE: string;

function seed() {
  return {
    userId: USER,
    deviceId: DEVICE,
    projectId: PROJECT,
    workspaceId: null,
    spriteName: SPRITE,
  };
}

function input() {
  return provisionInput({
    seed: seed(),
    gatewayUrl: "https://exeora.dev",
    cliVersion: "0.16.0",
    repoUrl: "https://github.com/leynier/exeora.git",
    branch: "main",
    cliConfig: cliConfigFor({
      gatewayUrl: "https://exeora.dev",
      deviceId: DEVICE,
      project: { id: PROJECT, slug: "demo", name: "Demo" },
      workspace: { id: "wsp_main", slug: "main", branch: "main" },
    }),
    machineToken: mintMachineToken(DEVICE),
  });
}

/** A Sprites API that does what it is told; `answer` overrides one route. */
function fakeSprites(answer: (request: Request) => Response | undefined = () => undefined) {
  const calls: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    const request = new Request(target, init);
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    const custom = answer(request);
    if (custom) return custom;
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/v1/sprites") {
      return Response.json(
        { id: "s1", name: SPRITE, url: "https://sprite.test", status: "cold" },
        { status: 201 },
      );
    }
    if (path.endsWith("/exec")) {
      return new Response("bootstrap: done\nEXEORA_BOOTSTRAP_OK\n\n__EXEORA_EXIT_0__\n");
    }
    if (request.method === "PUT" && path.endsWith("/services/exeora")) {
      return Response.json({ name: "exeora" });
    }
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: "s1", name: SPRITE, url: "https://sprite.test", status: "cold" });
  });
  return { fetcher, calls };
}

const machine = () => env.CLOUD_MACHINE.getByName(DEVICE);

/**
 * Hands the object a fetcher and holds its alarms an hour away, so each step
 * runs only when the test says so rather than the moment it is scheduled.
 */
async function useFetcher(fetcher: typeof fetch) {
  await runInDurableObject(machine(), (instance: CloudMachine) => {
    const inside = instance as unknown as { fetcher: typeof fetch; alarmFloorMs: number };
    inside.fetcher = fetcher;
    inside.alarmFloorMs = 3_600_000;
  });
}

const step = () => runDurableObjectAlarm(machine());

async function row() {
  return db(env)
    .select()
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.deviceId, DEVICE))
    .get();
}

async function relayConfig() {
  return runInDurableObject(
    env.DEVICE_RELAY.getByName(relayName(USER, DEVICE)),
    (_instance, state) => state.storage.get<CloudRelayConfig>("cloud:config"),
  );
}

/** A CLI connecting to the machine's relay, the way the real one will. */
async function connectExecutor() {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, DEVICE)).fetch(
    new Request(`https://relay/connect?deviceId=${DEVICE}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      if (decodeRelayMessage(String(event.data))?.type === "hello.ack") resolve();
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE,
      cliVersion: "0.16.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "demo" }],
      capabilities: { prompt: false, tools: ["read_file"], features: ["cloud-v1"] },
    }),
  );
  await acknowledged;
  return socket;
}

beforeEach(async () => {
  DEVICE = `dev_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
  SPRITE = `exeora-${DEVICE.slice(4)}`;
  const database = db(env);
  await database
    .insert(schema.users)
    .values({ id: USER, email: "cloud-machine@example.com" })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE, userId: USER, name: "demo (main)", platform: "linux", kind: "cloud" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: USER,
      deviceId: DEVICE,
      name: "Demo",
      slug: "demo",
      localPath: "/home/sprite/workspace",
    })
    .onConflictDoUpdate({ target: schema.projects.id, set: { deviceId: DEVICE } })
    .run();
  // Machines of earlier tests share the project and would read as children
  // the main machine has to wait for.
  await database
    .delete(schema.cloudMachines)
    .where(eq(schema.cloudMachines.projectId, PROJECT))
    .run();
  await database
    .insert(schema.cloudMachines)
    .values({ deviceId: DEVICE, userId: USER, projectId: PROJECT, spriteName: SPRITE })
    .run();
});

describe("provisioning a cloud machine", () => {
  it("walks from an empty record to a ready machine, one alarm per step", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    expect(await row()).toMatchObject({ status: "creating", step: "Creating machine" });

    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("bootstrap");
    expect(await relayConfig()).toEqual({ url: "https://sprite.test", spriteName: SPRITE });
    expect((await row())?.spriteUrl).toBe("https://sprite.test");

    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("service");
    // The bootstrap delivered the secrets; nothing keeps them after that.
    await expect(
      runInDurableObject(machine(), (_instance, state) => state.storage.get("secrets")),
    ).resolves.toBeUndefined();

    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("wait-hello");
    expect(sprites.calls).toContain(`PUT /v1/sprites/${SPRITE}/services/exeora`);

    // Nobody has connected: the step waits and asks again, and each ask
    // reaches the machine so it stays awake through the clone.
    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("wait-hello");
    expect(await row()).toMatchObject({ status: "creating" });
    expect(sprites.calls.filter((call) => call === "GET /wake").length).toBeGreaterThan(0);

    const socket = await connectExecutor();
    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("ready");
    expect(await row()).toMatchObject({ status: "ready", step: null, error: null });
    expect((await row())?.readyAt).not.toBeNull();
    expect(await step()).toBe(false);
    socket.close(1000, "done");
  });

  it("keeps the bootstrap material until the phase has moved on", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await step();
    expect((await machine().status())?.phase).toBe("bootstrap");

    // The bootstrap itself succeeds, then the row write fails: the database
    // is away for a moment. The step must be retryable with its secrets.
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error("D1 is unavailable");
        },
      },
    );
    await runInDurableObject(machine(), (instance: CloudMachine) => {
      (instance as unknown as { env: Env }).env = {
        ...env,
        DB: broken as D1Database,
      } as unknown as Env;
    });
    expect(await step()).toBe(true);
    expect(await machine().status()).toMatchObject({ phase: "bootstrap", attempts: 1 });
    await expect(
      runInDurableObject(machine(), (_instance, state) => state.storage.get("secrets")),
    ).resolves.toBeDefined();

    await runInDurableObject(machine(), (instance: CloudMachine) => {
      (instance as unknown as { env: Env }).env = env as unknown as Env;
    });
    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("service");
    await expect(
      runInDurableObject(machine(), (_instance, state) => state.storage.get("secrets")),
    ).resolves.toBeUndefined();
  });

  it("gives up at once on a base branch the repository does not have", async () => {
    const sprites = fakeSprites((request) =>
      new URL(request.url).pathname.endsWith("/exec")
        ? new Response(
            "bootstrap: installing\nEXEORA_BOOTSTRAP_FATAL The base nope is not a branch or tag of the repository.\n__EXEORA_EXIT_4__\n",
          )
        : undefined,
    );
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await step();
    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("error");
    expect(await row()).toMatchObject({ status: "error" });
    expect((await row())?.error).toBe("The base nope is not a branch or tag of the repository.");
    expect(await step()).toBe(false);
  });

  it("retries a provider that is down and stops on a token it rejects", async () => {
    const down = fakeSprites((request) =>
      request.method === "POST" ? new Response("bad gateway", { status: 502 }) : undefined,
    );
    await useFetcher(down.fetcher);
    await machine().provision(input());

    expect(await step()).toBe(true);
    expect(await machine().status()).toMatchObject({ phase: "create", attempts: 1 });
    expect((await machine().status())?.lastError).toContain("502");
    expect(await row()).toMatchObject({ status: "creating" });

    const rejected = fakeSprites((request) =>
      request.method === "POST" ? new Response("no", { status: 401 }) : undefined,
    );
    await useFetcher(rejected.fetcher);
    expect(await step()).toBe(true);
    expect((await machine().status())?.phase).toBe("error");
    expect(await row()).toMatchObject({ status: "error" });
    expect((await row())?.error).toContain("token was rejected");
    expect(await step()).toBe(false);
  });

  it("destroys the Sprite, the device and its rows, and forgets itself", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await step();

    await machine().destroy(seed());
    expect(await row()).toMatchObject({ status: "destroying" });

    expect(await step()).toBe(true);
    expect(sprites.calls).toContain(`DELETE /v1/sprites/${SPRITE}`);
    expect(await row()).toBeUndefined();
    const device = await db(env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.id, DEVICE))
      .get();
    expect(device).toBeUndefined();
    expect(await machine().status()).toBeNull();
    expect(await relayConfig()).toBeUndefined();
  });

  it("takes the main machine down only once every child has its own teardown under way", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await step();

    // A workspace machine of the same project whose object was never told.
    const child = `dev_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
    const database = db(env);
    await database
      .insert(schema.devices)
      .values({ id: child, userId: USER, name: "demo (feature)", platform: "linux", kind: "cloud" })
      .run();
    await database
      .insert(schema.workspaces)
      .values({
        id: `wsp_${child.slice(4)}`,
        projectId: PROJECT,
        slug: "feature",
        name: "feature",
        branch: "feature",
        localPath: "/home/sprite/workspace",
        managed: true,
        deviceId: child,
      })
      .run();
    await database
      .insert(schema.cloudMachines)
      .values({
        deviceId: child,
        userId: USER,
        projectId: PROJECT,
        workspaceId: `wsp_${child.slice(4)}`,
        spriteName: `exeora-${child.slice(4)}`,
        status: "ready",
      })
      .run();
    await runInDurableObject(env.CLOUD_MACHINE.getByName(child), (instance: CloudMachine) => {
      const inside = instance as unknown as { fetcher: typeof fetch; alarmFloorMs: number };
      inside.fetcher = sprites.fetcher;
      inside.alarmFloorMs = 3_600_000;
    });

    await machine().destroy(seed());
    expect(await step()).toBe(true);
    // The child was told, and the main is still here, waiting on it.
    const childRow = await database
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, child))
      .get();
    expect(childRow).toEqual({ status: "destroying" });
    expect(await row()).toMatchObject({ status: "destroying" });
    expect(sprites.calls).not.toContain(`DELETE /v1/sprites/${SPRITE}`);

    expect(await step()).toBe(true);
    expect(sprites.calls).toContain(`DELETE /v1/sprites/${SPRITE}`);
    expect(await row()).toBeUndefined();
  });

  it("refuses a provision that arrives after the destroy, before and after it ran", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().destroy(seed());
    await machine().provision(input());
    expect(await machine().status()).toMatchObject({ phase: "destroy" });
    expect(await row()).toMatchObject({ status: "destroying" });
    // The device stops counting the moment the destruction is accepted.
    const device = await db(env)
      .select({ revokedAt: schema.devices.revokedAt })
      .from(schema.devices)
      .where(eq(schema.devices.id, DEVICE))
      .get();
    expect(device?.revokedAt).not.toBeNull();

    expect(await step()).toBe(true);
    await machine().provision(input());
    expect(await machine().status()).toBeNull();
    expect(sprites.calls).not.toContain("POST /v1/sprites");
  });

  it("lets a destroy that lands during a step win over that step", async () => {
    const sprites = fakeSprites();
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await step();
    // The step in flight would advance to `service`; the destroy has rewritten
    // the phase first, and the alarm that follows is destruction, not service.
    await machine().destroy(seed());
    expect(await step()).toBe(true);
    expect(sprites.calls).not.toContain(`PUT /v1/sprites/${SPRITE}/services/exeora`);
    expect(await machine().status()).toBeNull();
  });
});

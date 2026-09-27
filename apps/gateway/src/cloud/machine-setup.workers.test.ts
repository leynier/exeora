import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  CLOUD_HOOKS_FEATURE,
  type CloudHookRun,
  encodeMessage,
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import { cliConfigFor } from "./bootstrap.js";
import { hookRunOf } from "./hooks.js";
import { type CloudMachine, provisionInput } from "./machine-do.js";
import { mintMachineToken } from "./machine-tokens.js";

/**
 * What a machine is given after its bootstrap and before it is handed over:
 * its tools, and the project's install script.
 */

const USER = "usr_cloud_setup";
const PROJECT = "prj_cloud_setup";
let DEVICE: string;
let SPRITE: string;

const TOOLS_OK =
  "EXEORA_TOOL gh installed 2.101.0 yes -\nEXEORA_TOOL jq failed - no the download timed out\nEXEORA_ENV os=ubuntu-25.10 arch=x86_64 sudo=no apt=no shm=yes\nEXEORA_TOOLS_OK\n\n__EXEORA_EXIT_0__\n";
const TOOLS_WITHOUT_GH =
  "EXEORA_TOOL gh failed - yes the download was refused\nEXEORA_TOOL jq installed 1.8.2 no -\nEXEORA_ENV os=ubuntu-25.10 arch=x86_64 sudo=no apt=no shm=yes\nEXEORA_TOOLS_FAILED gh the download was refused\n\n__EXEORA_EXIT_1__\n";

function input() {
  const seed = {
    userId: USER,
    deviceId: DEVICE,
    projectId: PROJECT,
    workspaceId: null,
    spriteName: SPRITE,
  };
  return provisionInput({
    seed,
    gatewayUrl: "https://exeora.dev",
    cliVersion: "0.19.0",
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

/** A Sprites API whose tools step says what the test tells it to. */
function fakeSprites(tools: () => string) {
  const calls: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    const request = new Request(target, init);
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/v1/sprites") {
      return Response.json(
        { id: "s1", name: SPRITE, url: "https://sprite.test", status: "cold" },
        { status: 201 },
      );
    }
    if (path.endsWith("/exec")) {
      const script = await request.clone().text();
      if (script.includes("EXEORA_TOOLS_OK")) return new Response(tools());
      return new Response("bootstrap: done\nEXEORA_BOOTSTRAP_OK\n\n__EXEORA_EXIT_0__\n");
    }
    if (request.method === "PUT") return Response.json({ name: "exeora" });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: "s1", name: SPRITE, url: "https://sprite.test", status: "cold" });
  });
  return { fetcher, calls };
}

const machine = () => env.CLOUD_MACHINE.getByName(DEVICE);

async function useFetcher(fetcher: typeof fetch) {
  await runInDurableObject(machine(), (instance: CloudMachine) => {
    const inside = instance as unknown as { fetcher: typeof fetch; alarmFloorMs: number };
    inside.fetcher = fetcher;
    inside.alarmFloorMs = 3_600_000;
  });
}

const step = () => runDurableObjectAlarm(machine());
const phase = async () => (await machine().status())?.phase;

const row = () =>
  db(env)
    .select()
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.deviceId, DEVICE))
    .get();

/** Walks a new machine up to the step named. */
async function until(wanted: string) {
  for (let steps = 0; steps < 12 && (await phase()) !== wanted; steps += 1) await step();
  expect(await phase()).toBe(wanted);
}

async function connect(features: string[]) {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, DEVICE)).fetch(
    new Request(`https://relay/connect?deviceId=${DEVICE}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      if (String(event.data).includes('"hello.ack"')) resolve();
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE,
      cliVersion: "0.19.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "demo" }],
      capabilities: { prompt: false, tools: ["read_file"], features },
    }),
  );
  await acknowledged;
  return socket;
}

const run = (fields: Partial<CloudHookRun>): CloudHookRun => ({
  runId: "run_install",
  status: "ok",
  source: "repository",
  trigger: "setup",
  scriptSha256: "b".repeat(64),
  exitCode: 0,
  startedAt: Date.now(),
  finishedAt: Date.now(),
  truncated: false,
  ...fields,
});

async function say(socket: WebSocket, state: CloudHookRun) {
  socket.send(encodeMessage({ type: "cloud.hook.state", hook: "install", run: state }));
  await new Promise((resolve) => setTimeout(resolve, 150));
}

beforeEach(async () => {
  DEVICE = `dev_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
  SPRITE = `exeora-${DEVICE.slice(4)}`;
  const database = db(env);
  await database
    .insert(schema.users)
    .values({ id: USER, email: "cloud-setup@example.com" })
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
  await database
    .delete(schema.cloudMachines)
    .where(eq(schema.cloudMachines.projectId, PROJECT))
    .run();
  await database
    .insert(schema.cloudMachines)
    .values({
      deviceId: DEVICE,
      userId: USER,
      projectId: PROJECT,
      spriteName: SPRITE,
      // What an attempt before this one left behind.
      installHook: JSON.stringify(run({ status: "failed", exitCode: 1, startedAt: 1 })),
      toolsReport: JSON.stringify({ tools: [], environment: {} }),
    })
    .run();
});

describe("the tools of a machine", () => {
  it("goes on without a tool that is not gh, and writes down which", async () => {
    const sprites = fakeSprites(() => TOOLS_OK);
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    // Made again from nothing: what the last attempt said is gone.
    expect(await row()).toMatchObject({ installHook: null, toolsReport: null });

    await until("service");

    expect(JSON.parse((await row())?.toolsReport ?? "null")).toEqual({
      tools: [
        { name: "gh", state: "installed", version: "2.101.0", required: true, reason: null },
        {
          name: "jq",
          state: "failed",
          version: null,
          required: false,
          reason: "the download timed out",
        },
      ],
      environment: {
        os: "ubuntu-25.10",
        arch: "x86_64",
        sudo: false,
        apt: false,
        memoryDisk: true,
      },
    });
    expect(await row()).toMatchObject({ status: "creating", step: "Starting" });
  });

  it("tries again when gh could not be installed, and goes on once it can", async () => {
    let answer = TOOLS_WITHOUT_GH;
    const sprites = fakeSprites(() => answer);
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await until("tools");

    expect(await step()).toBe(true);
    expect(await machine().status()).toMatchObject({ phase: "tools", attempts: 1 });
    // Not given up on, and what it found is already there to read.
    expect(await row()).toMatchObject({ status: "creating" });
    expect(JSON.parse((await row())?.toolsReport ?? "null")).toMatchObject({
      tools: [
        { name: "gh", state: "failed" },
        { name: "jq", state: "installed" },
      ],
    });

    answer = TOOLS_OK;
    expect(await step()).toBe(true);
    expect(await phase()).toBe("service");
  });

  it("says that it was gh, and why, when no attempt could install it", async () => {
    const sprites = fakeSprites(() => TOOLS_WITHOUT_GH);
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await until("tools");

    for (let attempt = 0; attempt < 8 && (await phase()) === "tools"; attempt += 1) await step();

    expect(await phase()).toBe("error");
    expect(await row()).toMatchObject({
      status: "error",
      errorCode: "tools_failed",
      error:
        "The GitHub CLI (gh) could not be installed on the machine: the download was refused. Retry to try again.",
    });
    expect((await row())?.errorDetail).toContain("EXEORA_TOOLS_FAILED gh");
    // The service was never registered: a machine without gh is not started.
    expect(sprites.calls).not.toContain(`PUT /v1/sprites/${SPRITE}/services/exeora`);
  });
});

describe("waiting for the install script", () => {
  async function connected(features: string[]) {
    const sprites = fakeSprites(() => TOOLS_OK);
    await useFetcher(sprites.fetcher);
    await machine().provision(input());
    await until("wait-hello");
    return connect(features);
  }

  it("hands a machine over at once when its CLI runs no scripts", async () => {
    const socket = await connected(["cloud-v1"]);

    expect(await step()).toBe(true);

    expect(await phase()).toBe("ready");
    expect(await row()).toMatchObject({ status: "ready", step: null });
    socket.close(1000, "done");
  });

  it("holds a machine back while its install script runs", async () => {
    const socket = await connected(["cloud-v1", CLOUD_HOOKS_FEATURE]);

    expect(await step()).toBe(true);
    expect(await phase()).toBe("wait-install");
    expect(await row()).toMatchObject({ status: "creating", step: "Running the install script" });

    await say(socket, run({ status: "running", exitCode: null, finishedAt: null }));
    expect(await step()).toBe(true);
    expect(await phase()).toBe("wait-install");
    expect(await row()).toMatchObject({ status: "creating" });

    await say(socket, run({ status: "ok" }));
    expect(await step()).toBe(true);
    expect(await phase()).toBe("ready");
    expect(await row()).toMatchObject({ status: "ready", step: null, error: null });
    socket.close(1000, "done");
  });

  it("hands over a machine whose install script failed, with what it said", async () => {
    const socket = await connected(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    await step();

    await say(socket, run({ status: "failed", exitCode: 3, output: "npm ERR! missing script" }));
    expect(await step()).toBe(true);

    expect(await phase()).toBe("ready");
    // Ready, and not failed: the machine was made, and has something to say.
    expect(await row()).toMatchObject({ status: "ready", error: null, errorCode: null });
    expect(hookRunOf((await row())?.installHook ?? null)).toMatchObject({
      status: "failed",
      exitCode: 3,
      output: "npm ERR! missing script",
    });
    socket.close(1000, "done");
  });

  it("hands over a machine that has no script to run", async () => {
    const socket = await connected(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    await step();

    await say(
      socket,
      run({ status: "skipped", source: "none", scriptSha256: null, exitCode: null }),
    );
    expect(await step()).toBe(true);

    expect(await phase()).toBe("ready");
    socket.close(1000, "done");
  });

  it("does not wait for ever on a machine that never says how it went", async () => {
    const socket = await connected(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    await step();
    expect(await phase()).toBe("wait-install");

    // As if the wait had begun before the script's own limit.
    await runInDurableObject(machine(), async (_instance, state) => {
      const record = await state.storage.get<{ phaseStartedAt: number }>("machine");
      await state.storage.put("machine", { ...record, phaseStartedAt: Date.now() - 23 * 60_000 });
    });
    expect(await step()).toBe(true);

    expect(await phase()).toBe("ready");
    expect(await row()).toMatchObject({ status: "ready" });
    expect(hookRunOf((await row())?.installHook ?? null)).toMatchObject({
      status: "timed_out",
      output: "The machine never said how the install script ended.",
    });
    socket.close(1000, "done");
  });
});

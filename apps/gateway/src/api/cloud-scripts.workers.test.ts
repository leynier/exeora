import { env } from "cloudflare:test";
import {
  CLOUD_HOOKS_FEATURE,
  type CloudHookRun,
  decodeRelayMessage,
  encodeMessage,
  MAX_CLOUD_SCRIPT_BYTES,
  PROTOCOL_VERSION,
  type RelayMessage,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { hookRunOf } from "../cloud/hooks.js";
import { db, schema } from "../db/client.js";
import { listMachines } from "../machines-view.js";
import { call as request } from "./clients-fixtures.js";
import { relayName } from "./ops.js";

/**
 * A project's scripts, from the page that writes them to the instance that
 * runs them and back: what is saved, what an instance is told when it says
 * hello, and what becomes of what it reports.
 */

const USER = "usr_cloud_scripts";
const OTHER = "usr_cloud_scripts_other";
const LAPTOP = "dev_cs_laptop";
const PROJECT = "prj_cloud_scripts";
let INSTANCE: string;

const call = (path: string, method = "GET", body?: unknown, userId = USER) =>
  request(path, { method, userId, ...(body === undefined ? {} : { body }) });

beforeEach(async () => {
  INSTANCE = `dev_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
    await database
      .insert(schema.users)
      .values({ id, email: `${id}@example.com`, plan: "pro", cloudEnabled: true })
      .run();
  }
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      {
        id: INSTANCE,
        userId: USER,
        name: "api (main)",
        platform: "linux",
        kind: "cloud",
        cliVersion: "0.19.0",
      },
    ])
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: USER,
      deviceId: LAPTOP,
      name: "api",
      slug: "api",
      localPath: "/home/me/code/api",
      repoUrl: "https://github.com/acme/api.git",
      repoKey: "github.com/acme/api",
    })
    .run();
  await database
    .insert(schema.cloudMachines)
    .values({
      deviceId: INSTANCE,
      userId: USER,
      projectId: PROJECT,
      spriteName: `exeora-${INSTANCE.slice(4)}`,
      status: "ready",
    })
    .run();
});

const scripts = "/api/projects/prj_cloud_scripts/cloud-scripts";

/** An instance that says hello, and keeps what it is told. */
async function instance(features: string[]) {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, INSTANCE)).fetch(
    new Request(`https://relay/connect?deviceId=${INSTANCE}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const heard: RelayMessage[] = [];
  const waiting: Array<{ type: string; resolve: (message: RelayMessage) => void }> = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = decodeRelayMessage(String(event.data));
    if (!message) return;
    heard.push(message);
    const index = waiting.findIndex((entry) => entry.type === message.type);
    if (index >= 0) waiting.splice(index, 1)[0]?.resolve(message);
  });
  const next = (type: RelayMessage["type"]) =>
    new Promise<RelayMessage>((resolve, reject) => {
      const already = heard.find((message) => message.type === type);
      if (already) return resolve(already);
      waiting.push({ type, resolve });
      setTimeout(() => reject(new Error(`the relay never sent ${type}`)), 5_000);
    });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: INSTANCE,
      cliVersion: "0.19.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "api" }],
      capabilities: { prompt: false, tools: ["read_file"], features },
    }),
  );
  const ack = await next("hello.ack");
  if (ack.type !== "hello.ack") throw new Error("unexpected frame");
  return { socket, ack, next };
}

const run = (fields: Partial<CloudHookRun> = {}): CloudHookRun => ({
  runId: "run_1",
  status: "ok",
  source: "dashboard",
  trigger: "setup",
  scriptSha256: "a".repeat(64),
  exitCode: 0,
  startedAt: 1_000,
  finishedAt: 2_000,
  truncated: false,
  ...fields,
});

const stored = async (column: "installHook" | "resumeHook") => {
  const row = await db(env)
    .select()
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.deviceId, INSTANCE))
    .get();
  return hookRunOf(row?.[column] ?? null);
};

/** Lets the relay take a frame that was sent without an answer to wait for. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("the scripts of a project, on its page", () => {
  it("has none until somebody writes one, and lets the repository's run", async () => {
    const response = await call(scripts);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      install: null,
      resume: null,
      runRepositoryScripts: true,
      updatedAt: null,
    });
  });

  it("keeps what was written, as a shell reads it", async () => {
    const saved = await call(scripts, "PUT", {
      install: "npm ci\r\nnpm run build",
      resume: "   \n  ",
      runRepositoryScripts: false,
    });

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      install: "npm ci\nnpm run build\n",
      // Whitespace is not a script: it is how a field is left empty.
      resume: null,
      runRepositoryScripts: false,
    });
    expect(await (await call(scripts)).json()).toMatchObject({
      install: "npm ci\nnpm run build\n",
      resume: null,
      runRepositoryScripts: false,
      updatedAt: expect.any(Number),
    });
  });

  it("refuses a script that is too large, by name and with the limit", async () => {
    // Counted in bytes: each of these is three.
    const large = "€".repeat(Math.floor(MAX_CLOUD_SCRIPT_BYTES / 3) + 1);

    const refused = await call(scripts, "PUT", { install: "true", resume: large });

    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: "script_too_large",
      hook: "resume",
      max: MAX_CLOUD_SCRIPT_BYTES,
    });
    expect(await (await call(scripts)).json()).toMatchObject({ install: null, resume: null });
  });

  it("refuses what no shell could read", async () => {
    const refused = await call(scripts, "PUT", { install: "echo a\u0000b", resume: null });

    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: "invalid_script", hook: "install" });
  });

  it("is the owner's alone", async () => {
    expect((await call(scripts, "GET", undefined, OTHER)).status).toBe(404);
    const written = await call(scripts, "PUT", { install: "true", resume: null }, OTHER);
    expect(written.status).toBe(404);
    expect(await (await call(scripts)).json()).toMatchObject({ install: null });
  });

  it("outlives the project being taken off Exeora Cloud", async () => {
    await call(scripts, "PUT", { install: "make deps", resume: null });
    await db(env).delete(schema.cloudMachines).run();
    await db(env)
      .delete(schema.cloudProjects)
      .where(eq(schema.cloudProjects.projectId, PROJECT))
      .run();

    expect(await (await call(scripts)).json()).toMatchObject({ install: "make deps\n" });
  });
});

describe("what an instance is told, and what it says back", () => {
  it("is told the scripts when it says hello, if it runs them", async () => {
    await call(scripts, "PUT", { install: "make deps", resume: null, runRepositoryScripts: false });

    const { ack } = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);

    expect(ack).toMatchObject({
      cloudHooks: { scripts: { install: "make deps\n", resume: null }, repository: false },
    });
  });

  it("is told of an edit the next time it says hello", async () => {
    await call(scripts, "PUT", { install: null, resume: "echo one" });
    const first = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    expect(first.ack).toMatchObject({ cloudHooks: { scripts: { resume: "echo one\n" } } });

    await call(scripts, "PUT", { install: null, resume: "echo two" });
    const second = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);

    expect(second.ack).toMatchObject({ cloudHooks: { scripts: { resume: "echo two\n" } } });
  });

  it("tells nothing to a CLI from before the scripts", async () => {
    await call(scripts, "PUT", { install: "make deps", resume: null });

    const { ack } = await instance(["cloud-v1"]);

    expect(ack).not.toHaveProperty("cloudHooks");
  });

  it("keeps what the instance says of a run, and never goes back on it", async () => {
    const { socket } = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    const say = async (hook: "install" | "resume", state: CloudHookRun) => {
      socket.send(encodeMessage({ type: "cloud.hook.state", hook, run: state }));
      await settle();
    };

    await say("install", run({ status: "running", exitCode: null, finishedAt: null }));
    expect(await stored("installHook")).toMatchObject({ status: "running" });

    await say("install", run({ status: "failed", exitCode: 3, output: "npm ERR! missing" }));
    expect(await stored("installHook")).toMatchObject({ status: "failed", exitCode: 3 });

    // The beginning of the same run, arriving late, and a run from before.
    await say("install", run({ status: "running", exitCode: null, finishedAt: null }));
    await say("install", run({ runId: "run_0", startedAt: 500 }));
    expect(await stored("installHook")).toMatchObject({ runId: "run_1", status: "failed" });

    // A later run replaces it, and each script is kept apart.
    await say("install", run({ runId: "run_2", startedAt: 3_000 }));
    await say("resume", run({ runId: "run_r", trigger: "cold" }));
    expect(await stored("installHook")).toMatchObject({ runId: "run_2", status: "ok" });
    expect(await stored("resumeHook")).toMatchObject({ runId: "run_r", trigger: "cold" });
  });

  it("shows what a script printed only when it went wrong", async () => {
    const { socket } = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    socket.send(
      encodeMessage({
        type: "cloud.hook.state",
        hook: "install",
        run: run({ status: "failed", exitCode: 3, output: "npm ERR! missing" }),
      }),
    );
    socket.send(
      encodeMessage({
        type: "cloud.hook.state",
        hook: "resume",
        run: run({ runId: "run_r", trigger: "warm", output: "started the database" }),
      }),
    );
    await settle();

    const machines = await listMachines(env, USER);
    const shown = machines.find((machine) => machine.deviceId === INSTANCE);

    expect(shown).toMatchObject({
      kind: "cloud",
      hooks: {
        supported: true,
        install: { status: "failed", output: "npm ERR! missing" },
        resume: { status: "ok" },
      },
      tools: null,
    });
    expect(shown?.kind === "cloud" && shown.hooks.resume).not.toHaveProperty("output");
  });

  it("says which instances never run them", async () => {
    await db(env)
      .update(schema.devices)
      .set({ cliVersion: "0.18.1" })
      .where(eq(schema.devices.id, INSTANCE))
      .run();

    const machines = await listMachines(env, USER);

    expect(machines.find((machine) => machine.deviceId === INSTANCE)).toMatchObject({
      hooks: { supported: false, install: null, resume: null },
    });
  });
});

describe("running a script again", () => {
  const again = (hook: string, deviceId = INSTANCE, userId = USER) =>
    call(`/api/cloud/machines/${deviceId}/hooks/${hook}/run`, "POST", undefined, userId);

  it("asks the instance, with the scripts as they are now", async () => {
    const { next } = await instance(["cloud-v1", CLOUD_HOOKS_FEATURE]);
    await call(scripts, "PUT", { install: "make deps", resume: null });

    const asked = await again("install");

    expect(asked.status).toBe(202);
    expect(await next("cloud.hook.run")).toMatchObject({
      hook: "install",
      config: { scripts: { install: "make deps\n", resume: null }, repository: true },
    });
  });

  it("says so when the instance was made before the scripts", async () => {
    await instance(["cloud-v1"]);

    const asked = await again("resume");

    expect(asked.status).toBe(409);
    expect(await asked.json()).toMatchObject({ error: "hooks_unsupported" });
  });

  it("says so when nothing is connected", async () => {
    const asked = await again("install");

    expect(asked.status).toBe(503);
    expect(await asked.json()).toMatchObject({ error: "machine_waking" });
  });

  it("knows two scripts, and only the owner's instances", async () => {
    expect((await again("teardown")).status).toBe(404);
    expect((await again("install", LAPTOP)).status).toBe(404);
    expect((await again("install", INSTANCE, OTHER)).status).toBe(404);
  });
});

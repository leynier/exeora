import { createExecutionContext, env } from "cloudflare:test";
import { decodeRelayMessage, encodeMessage, PROTOCOL_VERSION } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";
import { relayName } from "./ops.js";

const OWNER = "usr_reads_owner";
const OTHER = "usr_reads_other";
const DEVICE = "dev_reads";
const PROJECT = "prj_reads";

function call(path: string, body: unknown, userId = OWNER) {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[] } }).props = {
    userId,
    scopes: ["dashboard:manage"],
  };
  return api.fetch(
    new Request(`https://exeora.dev${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

/** A CLI on the project's relay that answers every workspace call with `value`. */
async function connectExecutor(features: string[], value: (action: unknown) => unknown) {
  const response = await env.DEVICE_RELAY.getByName(relayName(OWNER, DEVICE)).fetch(
    new Request(`https://relay/connect?deviceId=${DEVICE}`, {
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
          JSON.stringify({
            type: "workspace.result",
            requestId: message.requestId,
            durationMs: 1,
            result: { ok: true, value: value(message.action) },
          }),
        );
      }
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE,
      cliVersion: "0.20.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "reads" }],
      capabilities: { prompt: false, tools: ["read_file"], features, workspaceRouting: true },
    }),
  );
  await acknowledged;
  return { socket, seen };
}

beforeEach(async () => {
  const database = db(env);
  for (const userId of [OWNER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, userId)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: OWNER, email: "reads-owner@example.com" },
      { id: OTHER, email: "reads-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE, userId: OWNER, name: "reads machine", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: OWNER,
      deviceId: DEVICE,
      name: "reads",
      slug: "reads",
      localPath: "/work/reads",
    })
    .run();
});

describe("workspace reads", () => {
  it("dispatches a read to the machine and answers with its value", async () => {
    const executor = await connectExecutor(
      ["source-control-v1", "source-control-v2", "workspace-v2"],
      (action) => ({
        kind: "tree",
        path: (action as { path: string }).path,
        entries: [{ name: "src", path: "src", type: "directory", ignored: false }],
        truncated: false,
      }),
    );
    const response = await call(`/api/projects/${PROJECT}/workspace/reads`, {
      action: "tree",
      path: "src",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "tree", path: "src" });
    expect(executor.seen).toEqual([{ action: "tree", path: "src", showIgnored: false }]);
    executor.socket.close(1000, "done");
  });

  it("refuses a mutation, an unknown action and another owner", async () => {
    const mutation = await call(`/api/projects/${PROJECT}/workspace/reads`, {
      action: "file_write",
      path: "a.txt",
      content: "x",
    });
    expect(mutation.status).toBe(400);
    const unknown = await call(`/api/projects/${PROJECT}/workspace/reads`, { action: "nope" });
    expect(unknown.status).toBe(400);
    const other = await call(
      `/api/projects/${PROJECT}/workspace/reads`,
      { action: "status" },
      OTHER,
    );
    expect(other.status).toBe(404);
  });

  it("fails at once while the machine is offline", async () => {
    const response = await call(`/api/projects/${PROJECT}/workspace/reads`, { action: "log" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });
  });

  it("tells the actions route to send reads here", async () => {
    for (const action of [{ action: "log" }, { action: "search", query: "x" }]) {
      const response = await call(`/api/projects/${PROJECT}/workspace/actions`, action);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "use_read_endpoint" });
    }
  });

  it("reports each tab's feature in the capabilities", async () => {
    const executor = await connectExecutor(["source-control-v1", "terminal-v1"], () => null);
    const context = createExecutionContext();
    (context as { props?: { userId: string; scopes: string[] } }).props = {
      userId: OWNER,
      scopes: ["dashboard:manage"],
    };
    const response = await api.fetch(
      new Request(`https://exeora.dev/api/projects/${PROJECT}/workspace/capabilities`),
      env,
      context,
    );
    expect(await response.json()).toEqual({
      online: true,
      sourceControl: true,
      sourceControlV2: false,
      files: false,
      search: false,
      terminal: true,
      workspaceRouting: true,
    });
    executor.socket.close(1000, "done");
  });
});

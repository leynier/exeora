import { createExecutionContext, env } from "cloudflare:test";
import { decodeRelayMessage, encodeMessage, PROTOCOL_VERSION } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api } from "./index.js";
import { relayName } from "./ops.js";

const OWNER = "usr_workspace_owner";
const OTHER = "usr_workspace_other";
const DEVICE = "dev_workspace";
const PROJECT = "prj_workspace";

function call(path: string, userId = OWNER, method = "GET") {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[] } }).props = {
    userId,
    scopes: ["dashboard:manage"],
  };
  return api.fetch(new Request(`https://exeora.dev${path}`, { method }), env, context);
}

beforeEach(async () => {
  const database = db(env);
  for (const userId of [OWNER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, userId)).run();
  }
  await database
    .insert(schema.users)
    .values([
      { id: OWNER, email: "workspace-owner@example.com" },
      { id: OTHER, email: "workspace-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE, userId: OWNER, name: "workspace machine", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: OWNER,
      deviceId: DEVICE,
      name: "workspace",
      slug: "workspace",
      localPath: "/work/workspace",
    })
    .run();
});

describe("workspace ownership and availability", () => {
  it("reports capabilities without exposing the local executor to another owner", async () => {
    const owner = await call(`/api/projects/${PROJECT}/workspace/capabilities`);
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({
      online: false,
      sourceControl: false,
      terminal: false,
      workspaceRouting: false,
    });

    const other = await call(`/api/projects/${PROJECT}/workspace/capabilities`, OTHER);
    expect(other.status).toBe(404);
  });

  it("fails a status read immediately while the owner's machine is offline", async () => {
    const response = await call(`/api/projects/${PROJECT}/workspace/status`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });
  });

  it("never issues another owner a terminal ticket", async () => {
    const response = await call(`/api/projects/${PROJECT}/terminal-ticket`, OTHER, "POST");
    expect(response.status).toBe(404);
  });

  it("closes terminals only for the owner, and reports when none was open", async () => {
    const other = await call(`/api/projects/${PROJECT}/terminal`, OTHER, "DELETE");
    expect(other.status).toBe(404);
    const owner = await call(`/api/projects/${PROJECT}/terminal`, OWNER, "DELETE");
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({ closed: false });
  });

  it("lists no terminals while none are open", async () => {
    const response = await call("/api/terminals");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    const other = await call("/api/terminals", OTHER);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ items: [] });
  });

  it("resolves only workspaces that belong to the owner's project", async () => {
    await db(env)
      .insert(schema.workspaces)
      .values({
        id: "wsp_workspace",
        projectId: PROJECT,
        slug: "feature",
        name: "Feature",
        branch: "feature",
        localPath: "/work/feature",
        managed: true,
      })
      .run();

    const known = await call(
      `/api/projects/${PROJECT}/workspace/capabilities?workspace=wsp_workspace`,
    );
    expect(known.status).toBe(200);
    expect(await known.json()).toMatchObject({ online: false, workspaceRouting: false });

    const missing = await call(`/api/projects/${PROJECT}/workspace/status?workspace=missing`);
    expect(missing.status).toBe(404);
    const hidden = await call(
      `/api/projects/${PROJECT}/workspace/capabilities?workspace=feature`,
      OTHER,
    );
    expect(hidden.status).toBe(404);
  });

  it("asks the workspace's own machine when it has one", async () => {
    const CLOUD_DEVICE = `dev_workspace_cloud_${crypto.randomUUID().slice(0, 8)}`;
    const database = db(env);
    await database
      .insert(schema.devices)
      .values({ id: CLOUD_DEVICE, userId: OWNER, name: "cloud", platform: "linux", kind: "cloud" })
      .run();
    await database
      .insert(schema.workspaces)
      .values({
        id: "wsp_workspace_cloud",
        projectId: PROJECT,
        slug: "cloud",
        name: "Cloud",
        branch: "cloud",
        localPath: "/home/sprite/workspace",
        managed: true,
        deviceId: CLOUD_DEVICE,
      })
      .run();

    // A CLI connected to the workspace's relay, and nothing on the project's.
    const response = await env.DEVICE_RELAY.getByName(relayName(OWNER, CLOUD_DEVICE)).fetch(
      new Request(`https://relay/connect?deviceId=${CLOUD_DEVICE}`, {
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
        deviceId: CLOUD_DEVICE,
        cliVersion: "0.1.0",
        platform: "linux",
        projects: [{ id: PROJECT, slug: "workspace" }],
        capabilities: { prompt: false, tools: ["read_file"], workspaceRouting: true },
      }),
    );
    await acknowledged;

    const cloud = await call(`/api/projects/${PROJECT}/workspace/capabilities?workspace=cloud`);
    expect(cloud.status).toBe(200);
    expect(await cloud.json()).toMatchObject({ online: true, workspaceRouting: true });

    const root = await call(`/api/projects/${PROJECT}/workspace/capabilities`);
    expect(await root.json()).toMatchObject({ online: false });

    socket.close(1000, "done");
  });
});

import { env } from "cloudflare:test";
import {
  decodeRelayMessage,
  encodeMessage,
  PROJECT_CLONE_FEATURE,
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { registerProject } from "../project-register.js";
import { call as request } from "./clients-fixtures.js";
import { relayName } from "./ops.js";

/**
 * Making and removing a workspace from the dashboard, on a machine that is
 * not the project's default and has no copy of the repository yet.
 */

const USER = "usr_workspace_create";
const LAPTOP = "dev_wc_laptop";
const DESKTOP = "dev_wc_desktop";
let PROJECT: string;

const call = (path: string, body: unknown) => request(path, { method: "POST", userId: USER, body });

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "workspace-create@example.com", plan: "pro" })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
    ])
    .run();
  const made = await registerProject(
    env,
    USER,
    { deviceId: LAPTOP, name: "api", slug: "api", localPath: "/home/me/code/api" },
    {
      repoUrl: "https://github.com/acme/api.git",
      repoKey: "github.com/acme/api",
      defaultBranch: "main",
    },
  );
  if ("error" in made) throw new Error(made.error);
  PROJECT = made.id;
  await database
    .insert(schema.projectLocations)
    .values({
      id: "loc_wc_desktop",
      projectId: PROJECT,
      userId: USER,
      kind: "local",
      deviceId: DESKTOP,
      status: "pending",
    })
    .run();
});

/** A CLI on the desktop that clones when asked and makes what it is told to. */
async function desktop() {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, DESKTOP)).fetch(
    new Request(`https://relay/connect?deviceId=${DESKTOP}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const asked: Array<{ frame: string; what: unknown }> = [];
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "hello.ack") resolve();
      if (message?.type === "workspace.call") {
        asked.push({ frame: message.type, what: message.action });
        const value =
          message.action.action === "project_prepare"
            ? { kind: "prepared", localPath: "/home/me/exeora/api", adopted: false, branch: "main" }
            : {
                kind: "mutation",
                stdout: "",
                stderr: "",
                status: {
                  kind: "status",
                  repository: true,
                  head: "fix/a",
                  oid: null,
                  upstream: null,
                  ahead: 0,
                  behind: 0,
                  operation: null,
                  files: [],
                  branches: [],
                  remotes: [],
                },
                workspace: {
                  id: "wsp_wc_made",
                  slug: "fix-a",
                  name: "fix/a",
                  branch: "fix/a",
                  localPath: "/home/me/worktrees/api/fix-a",
                },
              };
        socket.send(
          encodeMessage({
            type: "workspace.result",
            requestId: message.requestId,
            durationMs: 1,
            result: { ok: true, value: value as never },
          }),
        );
      }
      if (message?.type === "tool.call") {
        asked.push({ frame: message.type, what: { tool: message.tool, args: message.arguments } });
        socket.send(
          encodeMessage({
            type: "tool.result",
            requestId: message.requestId,
            durationMs: 1,
            result: { ok: true, value: { outcome: "removed" } },
          }),
        );
      }
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DESKTOP,
      cliVersion: "0.18.0",
      platform: "linux",
      projects: [],
      capabilities: {
        prompt: false,
        tools: ["read_file", "remove_workspace"],
        features: ["source-control-v1", PROJECT_CLONE_FEATURE],
        workspaceRouting: true,
      },
    }),
  );
  await acknowledged;
  return { socket, asked };
}

describe("a workspace made from the dashboard", () => {
  it("clones the project on a machine that has no copy, then makes the workspace there", async () => {
    const cli = await desktop();

    const response = await call(`/api/projects/${PROJECT}/workspaces`, {
      branch: "fix/a",
      where: "desktop",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      where: "desktop",
      status: "ready",
      workspace: { slug: "fix-a", branch: "fix/a" },
    });
    expect(cli.asked.map((entry) => (entry.what as { action: string }).action)).toEqual([
      "project_prepare",
      "workspace_create",
    ]);
    const location = await db(env)
      .select()
      .from(schema.projectLocations)
      .where(eq(schema.projectLocations.id, "loc_wc_desktop"))
      .get();
    expect(location).toMatchObject({ status: "ready", localPath: "/home/me/exeora/api" });
    cli.socket.close(1000, "done");
  });

  it("says which locations there are when it is sent somewhere else", async () => {
    const response = await call(`/api/projects/${PROJECT}/workspaces`, {
      branch: "fix/a",
      where: "server",
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "unknown_location",
      message: expect.stringContaining("laptop, desktop"),
    });
  });

  it("answers at once when the machine is not connected", async () => {
    const response = await call(`/api/projects/${PROJECT}/workspaces`, {
      branch: "fix/a",
      where: "desktop",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });
  });

  it("is removed by the machine that holds it, with what was asked", async () => {
    await db(env)
      .insert(schema.workspaces)
      .values({
        id: "wsp_wc_remove",
        projectId: PROJECT,
        slug: "fix-b",
        name: "fix/b",
        branch: "fix/b",
        localPath: "/home/me/worktrees/api/fix-b",
        managed: true,
        deviceId: DESKTOP,
      })
      .run();
    const cli = await desktop();

    const response = await call(`/api/projects/${PROJECT}/workspaces/wsp_wc_remove/remove`, {
      force: true,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "removed" });
    expect(cli.asked).toEqual([
      {
        frame: "tool.call",
        what: { tool: "remove_workspace", args: { force: true, deleteBranch: false } },
      },
    ]);
    cli.socket.close(1000, "done");
  });

  it("does not remove a workspace of somebody else's project", async () => {
    const response = await request(`/api/projects/${PROJECT}/workspaces/wsp_nope/remove`, {
      method: "POST",
      userId: "usr_stranger",
      body: {},
    });

    expect(response.status).toBe(404);
  });
});

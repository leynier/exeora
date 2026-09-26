import { env } from "cloudflare:test";
import {
  decodeRelayMessage,
  ExeoraError,
  encodeMessage,
  PROTOCOL_VERSION,
  type WorkspaceUnpublished,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { advertisedTools } from "../advertised.js";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import { answerCloudWorkspaceTool, listWorkspacesWithCloud } from "./workspace-tools.js";

/**
 * The workspace tools as a cloud project answers them, without a machine on
 * the other end: creating one is asked of the provisioning object, and the
 * poll that follows reads the row it updates.
 */

const USER = "usr_cloud_tools";
let PROJECT: string;
let MAIN: string;

beforeEach(async () => {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 22);
  PROJECT = `prj_${suffix}`;
  MAIN = `dev_${suffix}`;
  const database = db(env);
  await database
    .insert(schema.users)
    .values({ id: USER, email: "cloud-tools@example.com", cloudEnabled: true, plan: "pro" })
    .onConflictDoUpdate({ target: schema.users.id, set: { plan: "pro", cloudEnabled: true } })
    .run();
  // Storage carries over between the tests in this file, and every cloud
  // machine counts against the plan: start each test from none.
  await database.delete(schema.devices).where(eq(schema.devices.userId, USER)).run();
  await database
    .insert(schema.devices)
    .values({ id: MAIN, userId: USER, name: "tools (main)", platform: "linux", kind: "cloud" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: USER,
      deviceId: MAIN,
      name: "Tools",
      slug: `tools-${suffix.slice(0, 6)}`,
      localPath: "/home/sprite/workspace",
    })
    .run();
  await database
    .insert(schema.cloudProjects)
    .values({
      projectId: PROJECT,
      userId: USER,
      repoUrl: "https://github.com/leynier/exeora.git",
      defaultBranch: "main",
    })
    .run();
  await database
    .insert(schema.cloudMachines)
    .values({
      deviceId: MAIN,
      userId: USER,
      projectId: PROJECT,
      spriteName: `exeora-${suffix}`,
      status: "ready",
    })
    .run();
});

/** A CLI on the workspace's machine that answers the gateway's one question. */
async function machineAnswering(deviceId: string, answer: WorkspaceUnpublished) {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, deviceId)).fetch(
    new Request(`https://relay/connect?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "hello.ack") resolve();
      if (message?.type === "workspace.call") {
        socket.send(
          encodeMessage({
            type: "workspace.result",
            requestId: message.requestId,
            durationMs: 1,
            result: { ok: true, value: answer },
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
      cliVersion: "0.17.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: "tools" }],
      capabilities: {
        prompt: false,
        tools: ["read_file"],
        features: ["cloud-v1", "source-control-v1"],
        workspaceRouting: true,
      },
    }),
  );
  await acknowledged;
  return socket;
}

async function readyWorkspace(branch: string, slug: string) {
  const created = call("create_workspace", { branch });
  let workspace: { id: string; slug: string; deviceId: string | null } | undefined;
  for (let i = 0; i < 50 && !workspace; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    workspace = await db(env)
      .select({
        id: schema.workspaces.id,
        slug: schema.workspaces.slug,
        deviceId: schema.workspaces.deviceId,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .get();
  }
  if (!workspace?.deviceId) throw new Error("the workspace was never recorded");
  await db(env)
    .update(schema.cloudMachines)
    .set({ status: "ready" })
    .where(eq(schema.cloudMachines.deviceId, workspace.deviceId))
    .run();
  await created;
  return { ...workspace, deviceId: workspace.deviceId };
}

function call(tool: Parameters<typeof answerCloudWorkspaceTool>[1]["tool"], args: unknown = {}) {
  return answerCloudWorkspaceTool(env, {
    userId: USER,
    projectId: PROJECT,
    tool,
    args,
    workspace: null,
    issuedAt: Date.now(),
  });
}

describe("workspace tools on a cloud project", () => {
  it("lets the checkout's own policy refuse a workspace before anything is made", async () => {
    const refused = answerCloudWorkspaceTool(env, {
      userId: USER,
      projectId: PROJECT,
      tool: "create_workspace",
      args: { branch: "feature/refused" },
      workspace: null,
      issuedAt: Date.now(),
      askMachine: async () => {
        throw new ExeoraError("FORBIDDEN", "This project's exeora.toml does not allow that.");
      },
    });
    await expect(refused).rejects.toMatchObject({ code: "FORBIDDEN" });
    const leftover = await db(env)
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.projectId, PROJECT))
      .all();
    expect(leftover).toEqual([]);
  });

  it("stops making machines for an account whose Cloud was switched off", async () => {
    await db(env)
      .update(schema.users)
      .set({ cloudEnabled: false })
      .where(eq(schema.users.id, USER))
      .run();
    await expect(call("create_workspace", { branch: "feature/off" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const leftover = await db(env)
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.projectId, PROJECT))
      .all();
    expect(leftover).toEqual([]);
  });

  it("answers nothing for a project that is not in the cloud", async () => {
    await db(env).delete(schema.cloudProjects).where(eq(schema.cloudProjects.projectId, PROJECT));
    await expect(call("list_git_workspaces")).resolves.toBeUndefined();
    await expect(call("read_file", { path: "x" })).resolves.toBeUndefined();
  });

  it("lists the machines as the repository's workspaces", async () => {
    await expect(call("list_git_workspaces")).resolves.toEqual({
      workspaces: [
        {
          path: "/home/sprite/workspace",
          branch: "main",
          primary: true,
          connected: true,
          connectedSlug: "main",
        },
      ],
    });
    await expect(call("attach_workspace", { branch: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(call("detach_workspace")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a workspace and returns once its machine is ready", async () => {
    const pending = call("create_workspace", { branch: "feature/x" });

    // Stand in for the provisioning object: flip the new row to ready.
    let deviceId: string | undefined;
    for (let i = 0; i < 50 && !deviceId; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const row = await db(env)
        .select({ deviceId: schema.cloudMachines.deviceId })
        .from(schema.cloudMachines)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.cloudMachines.workspaceId))
        .where(eq(schema.workspaces.projectId, PROJECT))
        .get();
      deviceId = row?.deviceId;
    }
    if (!deviceId) throw new Error("the workspace machine was never recorded");
    await db(env)
      .update(schema.cloudMachines)
      .set({ status: "ready" })
      .where(eq(schema.cloudMachines.deviceId, deviceId))
      .run();

    await expect(pending).resolves.toMatchObject({
      workspace: { slug: "feature-x", branch: "feature/x", managed: true },
      outcome: "active",
    });
    const listed = await listWorkspacesWithCloud(env, USER, PROJECT);
    expect(listed).toMatchObject([
      { slug: "feature-x", branch: "feature/x", cloud: { status: "ready", error: null } },
    ]);
    const tools = await advertisedTools(env, USER, PROJECT);
    expect(tools?.has("create_workspace")).toBe(true);
    expect(tools?.has("attach_workspace")).toBe(false);
  });

  it("reports a machine that failed, and a wait that ran out", async () => {
    const failing = call("create_workspace", { branch: "feature/y" });
    let deviceId: string | undefined;
    for (let i = 0; i < 50 && !deviceId; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const row = await db(env)
        .select({ deviceId: schema.cloudMachines.deviceId })
        .from(schema.cloudMachines)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.cloudMachines.workspaceId))
        .where(eq(schema.workspaces.slug, "feature-y"))
        .get();
      deviceId = row?.deviceId;
    }
    if (!deviceId) throw new Error("the workspace machine was never recorded");
    await db(env)
      .update(schema.cloudMachines)
      .set({ status: "error", error: "the Sprites token was rejected" })
      .where(eq(schema.cloudMachines.deviceId, deviceId))
      .run();
    await expect(failing).rejects.toMatchObject({ code: "TOOL_FAILED" });

    const late = answerCloudWorkspaceTool(env, {
      userId: USER,
      projectId: PROJECT,
      tool: "create_workspace",
      args: { branch: "feature/z" },
      workspace: null,
      issuedAt: Date.now() - 600_000,
    });
    await expect(late).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });

    await expect(call("create_workspace", { branch: "main" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
  });

  it("removes a workspace only when its machine says the remote has everything", async () => {
    const workspace = await readyWorkspace("feature/q", "feature-q");
    const target = { id: workspace.id, slug: workspace.slug };
    const remove = () =>
      answerCloudWorkspaceTool(env, {
        userId: USER,
        projectId: PROJECT,
        tool: "remove_workspace",
        args: {},
        workspace: target,
        issuedAt: Date.now(),
      });

    // A commit reachable only through a tag never pushed: refused, by name.
    const keeping = await machineAnswering(workspace.deviceId, {
      kind: "unpublished",
      clean: false,
      reasons: ["v-local was never pushed"],
    });
    await expect(remove()).rejects.toMatchObject({
      code: "TOOL_FAILED",
      message: expect.stringContaining("v-local was never pushed"),
    });
    keeping.close(1000, "done");

    const clean = await machineAnswering(workspace.deviceId, {
      kind: "unpublished",
      clean: true,
      reasons: [],
    });
    await expect(remove()).resolves.toMatchObject({ outcome: "removed" });
    clean.close(1000, "done");
  });

  it("refuses to remove a workspace it cannot check, unless forced", async () => {
    const workspace = await readyWorkspace("feature/r", "feature-r");

    const target = { id: workspace.id, slug: workspace.slug };
    // The machine cannot be reached: neither its policy nor its status.
    const unreachable = async () => {
      throw new ExeoraError("LOCAL_EXECUTOR_OFFLINE", "The cloud workspace did not wake up.");
    };
    const unforced = answerCloudWorkspaceTool(env, {
      userId: USER,
      projectId: PROJECT,
      tool: "remove_workspace",
      args: {},
      workspace: target,
      issuedAt: Date.now(),
      askMachine: unreachable,
    });
    await expect(unforced).rejects.toMatchObject({ code: "TOOL_FAILED" });

    // A refusal from the checkout's own policy stands even against force.
    await expect(
      answerCloudWorkspaceTool(env, {
        userId: USER,
        projectId: PROJECT,
        tool: "remove_workspace",
        args: { force: true },
        workspace: target,
        issuedAt: Date.now(),
        askMachine: async () => {
          throw new ExeoraError("FORBIDDEN", "exeora.toml does not allow that.");
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A cancellation is not a machine out of reach: force does not get past it.
    await expect(
      answerCloudWorkspaceTool(env, {
        userId: USER,
        projectId: PROJECT,
        tool: "remove_workspace",
        args: { force: true },
        workspace: target,
        issuedAt: Date.now(),
        askMachine: async () => {
          throw new ExeoraError("CANCELLED", "The call was cancelled.");
        },
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      answerCloudWorkspaceTool(env, {
        userId: USER,
        projectId: PROJECT,
        tool: "remove_workspace",
        args: { force: true },
        workspace: target,
        issuedAt: Date.now(),
        signal: AbortSignal.abort(),
        askMachine: unreachable,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    const untouched = await db(env)
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, workspace.deviceId))
      .get();
    expect(untouched).toEqual({ status: "ready" });

    await expect(
      answerCloudWorkspaceTool(env, {
        userId: USER,
        projectId: PROJECT,
        tool: "remove_workspace",
        args: { force: true },
        workspace: target,
        issuedAt: Date.now(),
        askMachine: unreachable,
      }),
    ).resolves.toMatchObject({ outcome: "removed", workspace: { slug: "feature-r" } });
    const machine = await db(env)
      .select({ status: schema.cloudMachines.status })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, workspace.deviceId))
      .get();
    expect(machine?.status).toBe("destroying");

    await expect(call("remove_workspace")).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });
});

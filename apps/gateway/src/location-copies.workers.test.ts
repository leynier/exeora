import { env } from "cloudflare:test";
import {
  decodeRelayMessage,
  encodeMessage,
  PROJECT_CLONE_FEATURE,
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { relayName } from "./api/ops.js";
import { finishCloudRemoval } from "./cloud/teardown.js";
import { db, schema } from "./db/client.js";
import { findLocation, locationsOf } from "./locations.js";
import { registerProject } from "./project-register.js";
import { prepareLocation } from "./workspace-placement.js";

/**
 * What happens at a location rather than between them: a machine getting its
 * first copy of a project, and a project leaving Exeora Cloud.
 */

const USER = "usr_location_copies";
const LAPTOP = "dev_copy_laptop";
const DESKTOP = "dev_copy_desktop";
const REPO = {
  repoUrl: "https://github.com/acme/api.git",
  repoKey: "github.com/acme/api",
  defaultBranch: "main",
};

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database
    .insert(schema.users)
    .values({ id: USER, email: "copies@example.com", plan: "pro", cloudEnabled: true })
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: LAPTOP, userId: USER, name: "Laptop", platform: "darwin" },
      { id: DESKTOP, userId: USER, name: "Desktop", platform: "linux" },
    ])
    .run();
});

const add = (deviceId: string, slug: string) =>
  registerProject(
    env,
    USER,
    { deviceId, name: slug, slug, localPath: `/home/me/code/${slug}` },
    REPO,
  );

async function locations(id: string) {
  const row = await db(env).select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!row) throw new Error("the project is gone");
  return (await locationsOf(env, USER, [row])).get(id) ?? [];
}

const count = async () =>
  (await db(env).select().from(schema.projects).where(eq(schema.projects.userId, USER)).all())
    .length;

describe("a machine that has no copy yet", () => {
  /** A CLI on the machine that answers the one thing it is asked. */
  async function machine(
    deviceId: string,
    options: { features: string[]; answer: (action: unknown) => unknown },
  ) {
    const response = await env.DEVICE_RELAY.getByName(relayName(USER, deviceId)).fetch(
      new Request(`https://relay/connect?deviceId=${deviceId}`, {
        headers: { Upgrade: "websocket" },
      }),
    );
    const socket = response.webSocket;
    if (!socket) throw new Error("the relay did not return a socket");
    socket.accept();
    const asked: unknown[] = [];
    const acknowledged = new Promise<void>((resolve) => {
      socket.addEventListener("message", (event: MessageEvent) => {
        const message = decodeRelayMessage(String(event.data));
        if (message?.type === "hello.ack") resolve();
        if (message?.type === "workspace.call") {
          asked.push(message.action);
          socket.send(
            encodeMessage({
              type: "workspace.result",
              requestId: message.requestId,
              durationMs: 1,
              result: options.answer(message.action) as never,
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
        cliVersion: "0.18.0",
        platform: "linux",
        projects: [],
        capabilities: {
          prompt: false,
          tools: ["read_file"],
          features: options.features,
          workspaceRouting: true,
        },
      }),
    );
    await acknowledged;
    return { socket, asked };
  }

  async function pending() {
    const made = await add(LAPTOP, "api");
    if ("error" in made) throw new Error(made.error);
    await db(env)
      .insert(schema.projectLocations)
      .values({
        id: "loc_pending_desktop",
        projectId: made.id,
        userId: USER,
        kind: "local",
        deviceId: DESKTOP,
        status: "pending",
      })
      .run();
    const desktop = findLocation(await locations(made.id), "desktop");
    if (!desktop) throw new Error("no desktop");
    return { projectId: made.id, desktop };
  }

  it("is asked to prepare one, and what it answers is written down", async () => {
    const { projectId, desktop } = await pending();
    expect(desktop.state).toBe("offline");
    const cli = await machine(DESKTOP, {
      features: ["source-control-v1", PROJECT_CLONE_FEATURE],
      answer: () => ({
        ok: true,
        value: {
          kind: "prepared",
          localPath: "/home/me/exeora/api",
          adopted: false,
          branch: "main",
        },
      }),
    });

    await prepareLocation(env, { userId: USER, projectId, location: desktop });

    expect(cli.asked).toEqual([
      {
        action: "project_prepare",
        repository: {
          url: REPO.repoUrl,
          slug: "api",
          name: "api",
          defaultBranch: "main",
          credential: "machine",
        },
      },
    ]);
    expect(findLocation(await locations(projectId), "desktop")).toMatchObject({
      status: "ready",
      localPath: "/home/me/exeora/api",
    });
    cli.socket.close(1000, "done");
  });

  it("says why when the clone failed, and what to do", async () => {
    const { projectId, desktop } = await pending();
    const cli = await machine(DESKTOP, {
      features: ["source-control-v1", PROJECT_CLONE_FEATURE],
      answer: () => ({
        ok: false,
        error: {
          code: "TOOL_FAILED",
          message: "fatal: Authentication failed for 'https://github.com/acme/api.git/'",
        },
      }),
    });

    await expect(
      prepareLocation(env, { userId: USER, projectId, location: desktop }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED", message: expect.stringContaining("Desktop") });

    expect(findLocation(await locations(projectId), "desktop")).toMatchObject({
      status: "error",
      errorCode: "clone_auth_failed",
      state: "failed",
    });
    cli.socket.close(1000, "done");
  });

  it("is not asked when its CLI is too old to clone", async () => {
    const { projectId, desktop } = await pending();
    const cli = await machine(DESKTOP, { features: ["source-control-v1"], answer: () => ({}) });

    await expect(
      prepareLocation(env, { userId: USER, projectId, location: desktop }),
    ).rejects.toMatchObject({ message: expect.stringContaining("exeora upgrade") });

    expect(cli.asked).toEqual([]);
    expect(findLocation(await locations(projectId), "desktop")?.status).toBe("pending");
    cli.socket.close(1000, "done");
  });
});

describe("taking a project off Exeora Cloud", () => {
  it("removes the location and leaves the project where else it lives", async () => {
    const made = await add(LAPTOP, "api");
    if ("error" in made) throw new Error(made.error);
    const database = db(env);
    await database
      .insert(schema.cloudProjects)
      .values({
        projectId: made.id,
        userId: USER,
        repoUrl: REPO.repoUrl,
        defaultBranch: "main",
        deletingAt: new Date(),
        deletingScope: "location",
      })
      .run();
    await database
      .insert(schema.projectLocations)
      .values({ id: "loc_cloud_api", projectId: made.id, userId: USER, kind: "cloud" })
      .run();

    expect(await finishCloudRemoval(env, USER, made.id)).toBe("location");

    expect((await locations(made.id)).map((location) => location.slug)).toEqual(["laptop"]);
    expect(
      await database
        .select()
        .from(schema.cloudProjects)
        .where(and(eq(schema.cloudProjects.projectId, made.id)))
        .get(),
    ).toBeUndefined();
    expect(await count()).toBe(1);
  });
});

import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db/client.js";
import { listMachines } from "./machines-view.js";
import { PluginAccess } from "./plugin-access.js";
import {
  PROJECT,
  pluginEnv,
  props,
  setupPluginFixture,
  USER,
} from "./plugin-extensions-fixtures.js";
import { panelRequest } from "./plugin-panel-api.js";

const origin = "https://exeora.web-sandbox.oaiusercontent.com";
beforeEach(setupPluginFixture);

async function policy(value: Record<string, unknown>) {
  await db(env)
    .update(schema.projects)
    .set({ commandPolicy: JSON.stringify(value) })
    .where(eq(schema.projects.id, PROJECT));
}

function guardedRelay() {
  const getByName = vi.fn(() => {
    throw new Error("A denied panel request must not contact the relay.");
  });
  return {
    getByName,
    bindings: { ...pluginEnv, DEVICE_RELAY: { getByName } } as unknown as Env,
  };
}

describe("plugin panel policy on account and project connections", () => {
  it.each([
    { tools: [] },
    { tools: ["list_files"] },
    { tools: ["list_files", "read_file"] },
    { tools: ["read_file", "grep"] },
  ])("refuses logs when any reader is excluded: $tools", async ({ tools }) => {
    await policy({ mode: "allow_all", tools });
    const { bindings, getByName } = guardedRelay();
    for (const projectId of [undefined, PROJECT]) {
      const result = await panelRequest(new PluginAccess(bindings, props, projectId), {
        path: `/api/projects/${PROJECT}/logs-ticket`,
        method: "POST",
        origin,
      });
      expect(result.status).toBe(403);
    }
    expect(getByName).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "allow_all", tools: [] },
    { mode: "read_only", tools: ["write_file"] },
  ])("never wakes a machine when no workspace tool is permitted: %j", async (value) => {
    await policy(value);
    const { bindings, getByName } = guardedRelay();
    for (const projectId of [undefined, PROJECT]) {
      const result = await panelRequest(new PluginAccess(bindings, props, projectId), {
        path: `/api/projects/${PROJECT}/workspace/capabilities`,
        method: "GET",
      });
      expect(result.status).toBe(403);
    }
    expect(getByName).not.toHaveBeenCalled();
  });

  it("preserves capability discovery when only writes are offered", async () => {
    await policy({ mode: "allow_all", tools: ["write_file"] });
    const capabilities = vi.fn(async () => null);
    const bindings = {
      ...pluginEnv,
      DEVICE_RELAY: { getByName: () => ({ capabilities }) },
    } as unknown as Env;
    for (const projectId of [undefined, PROJECT]) {
      const result = await panelRequest(new PluginAccess(bindings, props, projectId), {
        path: `/api/projects/${PROJECT}/workspace/capabilities`,
        method: "GET",
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ online: false, terminal: false });
    }
    expect(capabilities).toHaveBeenCalledWith({ wake: true });
  });

  it("keeps logs and capability discovery available to read-only connections", async () => {
    await policy({ mode: "read_only", tools: null });
    for (const projectId of [undefined, PROJECT]) {
      const access = new PluginAccess(pluginEnv, props, projectId);
      const logs = await panelRequest(access, {
        path: `/api/projects/${PROJECT}/logs-ticket`,
        method: "POST",
        origin,
      });
      expect(logs.status).toBe(200);
      expect(logs.body).toMatchObject({ url: expect.stringContaining("/logs/connect?") });
      const result = await panelRequest(access, {
        path: `/api/projects/${PROJECT}/workspace/capabilities`,
        method: "GET",
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ terminal: false });
    }
  });

  it("redacts machine diagnostics and hook output only from panel responses", async () => {
    const database = db(env);
    const privateOutput = "private-file=/work/secret.ts command=private-script";
    const hook = {
      runId: "run_panel_redaction",
      status: "failed",
      source: "dashboard",
      trigger: "setup",
      scriptSha256: null,
      exitCode: 1,
      startedAt: 1,
      finishedAt: 2,
      output: privateOutput,
      truncated: false,
    };
    await database.insert(schema.devices).values({
      id: "dev_plugin_cloud_redaction",
      userId: USER,
      name: "Cloud",
      platform: "linux",
      kind: "cloud",
      cliVersion: "0.21.0",
    });
    await database.insert(schema.cloudMachines).values({
      deviceId: "dev_plugin_cloud_redaction",
      userId: USER,
      projectId: PROJECT,
      spriteName: "plugin-redaction",
      status: "error",
      error: "Setup failed.",
      errorDetail: privateOutput,
      installHook: JSON.stringify(hook),
      resumeHook: JSON.stringify({ ...hook, status: "timed_out" }),
    });
    await policy({ mode: "allow_all", tools: [] });
    for (const projectId of [undefined, PROJECT]) {
      const result = await panelRequest(new PluginAccess(pluginEnv, props, projectId), {
        path: "/api/machines",
        method: "GET",
      });
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).not.toContain(privateOutput);
      expect(result.body).toMatchObject({
        machines: expect.arrayContaining([
          expect.objectContaining({
            kind: "cloud",
            error: "Setup failed.",
            errorDetail: null,
            hooks: {
              supported: true,
              install: expect.objectContaining({ status: "failed", exitCode: 1 }),
              resume: expect.objectContaining({ status: "timed_out" }),
            },
          }),
        ]),
      });
    }
    const original = (await listMachines(pluginEnv, USER)).find(
      (machine) => machine.kind === "cloud",
    );
    expect(original).toMatchObject({
      errorDetail: privateOutput,
      hooks: { install: { output: privateOutput }, resume: { output: privateOutput } },
    });
  });
});

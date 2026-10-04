import { createExecutionContext, env } from "cloudflare:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db/client.js";
import worker from "./index.js";
import { createProjectMcpHandler } from "./mcp.js";
import { createAccountMcpHandler } from "./mcp-account.js";
import { payload } from "./mcp-fixtures.js";
import { nowhereId, nowhereStatement } from "./nowhere.js";
import { PluginAccess } from "./plugin-access.js";
import {
  OTHER,
  PROJECT,
  pluginEnv,
  props,
  setupPluginFixture,
  USER,
} from "./plugin-extensions-fixtures.js";
import { panelRequest } from "./plugin-panel-api.js";
import { readPluginSettings, updatePluginSettings } from "./plugin-settings.js";

beforeEach(setupPluginFixture);

async function post(
  method: string,
  params: Record<string, unknown> = {},
  project?: string,
  modern = false,
) {
  const ctx = createExecutionContext();
  (ctx as unknown as { props: typeof props }).props = props;
  const url = project ? `/p/${project}/mcp` : "/mcp";
  const handler = project
    ? createProjectMcpHandler(
        project,
        async () => ({ kind: "value", value: {} }),
        pluginEnv,
        undefined,
        undefined,
        undefined,
        pluginEnv,
      )
    : createAccountMcpHandler(
        async () => ({ kind: "value", value: {} }),
        async () => ({}),
        pluginEnv,
        undefined,
        undefined,
        pluginEnv,
      );
  const body = await payload(
    await handler(
      new Request(`https://exeora.dev${url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": modern ? "2026-07-28" : "2025-11-25",
          ...(modern
            ? {
                "Mcp-Method": method,
                ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
              }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: modern
            ? {
                ...params,
                _meta: {
                  [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
                  [CLIENT_INFO_META_KEY]: { name: "ChatGPT", version: "1" },
                  [CLIENT_CAPABILITIES_META_KEY]: {},
                  ...(params._meta as Record<string, unknown> | undefined),
                },
              }
            : params,
        }),
      }),
      env,
      ctx,
    ),
  );
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body;
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
) {
  const body = await post("tools/call", {
    name,
    arguments: args,
    ...(meta ? { _meta: meta } : {}),
  });
  return body.result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { text: string }[];
  };
}

describe("OpenAI plugin wire contracts", () => {
  it("advertises settings through modern discovery and preserves host file metadata", async () => {
    const discover = await post("server/discover", {}, undefined, true);
    expect((discover.result as { capabilities: unknown }).capabilities).toMatchObject({
      extensions: {
        "openai/settings": {
          readTool: "exeora_settings_read",
          updateTool: "exeora_settings_update",
        },
      },
    });
    const resolved = await post(
      "tools/call",
      {
        name: "exeora_resolve_file",
        arguments: { file: { name: "app.ts", resourceUri: "host-resource://opaque" } },
        _meta: { "openai/resource": { path: "/work/allowed/app.ts" } },
      },
      undefined,
      true,
    );
    expect((resolved.result as { structuredContent: unknown }).structuredContent).toMatchObject({
      projectId: PROJECT,
      path: "app.ts",
    });
  });
  it("advertises thread, file and app-only tools on both endpoints", async () => {
    for (const project of [undefined, PROJECT]) {
      const body = await post("tools/list", {}, project);
      const tools = (
        body.result as {
          tools: { name: string; _meta?: Record<string, unknown>; outputSchema?: unknown }[];
        }
      ).tools;
      const panel = tools.find((tool) => tool.name === "exeora_open_panel");
      expect(panel?._meta).toMatchObject({
        ui: { resourceUri: "ui://exeora/workspace" },
        "openai/ui": { entrypoints: [{ type: "thread" }] },
      });
      const file = tools.find((tool) => tool.name === "exeora_open_file");
      expect(file?._meta).toMatchObject({
        ui: { visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: "file" }] },
      });
      expect(
        tools.find((tool) => tool.name === "exeora_settings_read")?.outputSchema,
      ).toBeDefined();
      expect(tools.find((tool) => tool.name === "exeora_panel_request")?._meta).toMatchObject({
        ui: { visibility: ["app"] },
      });
    }
  });
  it("advertises native settings in the legacy handshake", async () => {
    const body = await post("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "ChatGPT", version: "1" },
    });
    expect((body.result as { capabilities: unknown }).capabilities).toMatchObject({
      experimental: {
        "openai/settings": {
          readTool: "exeora_settings_read",
          updateTool: "exeora_settings_update",
        },
      },
    });
  });
  it("returns executable UI HTML with absolute assets and CSP", async () => {
    const body = await post("resources/read", { uri: "ui://exeora/workspace" });
    const content = (
      body.result as { contents: { text: string; mimeType: string; _meta: unknown }[] }
    ).contents[0];
    expect(content?.mimeType).toBe("text/html;profile=mcp-app");
    expect(content?.text).toContain('src="https://exeora.dev/dashboard/assets/panel.js"');
    expect(content?._meta).toMatchObject({
      "openai/ui": { preferredDisplayMode: "fullscreen" },
      ui: { csp: { resourceDomains: ["https://exeora.dev"] } },
    });
  });
  it("opens only granted selections and rejects arbitrary relative traversal", async () => {
    expect(
      (
        await call("exeora_open_panel", {
          project: "allowed",
          workspace: "feature",
          path: "src/app.ts",
        })
      ).structuredContent,
    ).toMatchObject({ projectId: PROJECT, workspace: "feature", path: "src/app.ts" });
    expect((await call("exeora_open_panel", { project: "hidden" })).isError).toBe(true);
    expect(
      (await call("exeora_open_panel", { project: "allowed", path: "../secret" })).isError,
    ).toBe(true);
  });
  it("resolves host metadata into the longest matching authorized checkout", async () => {
    const file = { name: "app.ts", resourceUri: "host-resource://opaque" };
    const opened = await call("exeora_open_file", { file });
    expect(opened.structuredContent).toMatchObject({ needsResolve: true });
    const resolved = await call(
      "exeora_resolve_file",
      { file },
      { "openai/resource": { path: "/work/allowed/worktrees/feature/src/app.ts" } },
    );
    expect(resolved.structuredContent).toMatchObject({
      projectId: PROJECT,
      workspace: "feature",
      path: "src/app.ts",
    });
    expect(
      (
        await call(
          "exeora_resolve_file",
          { file },
          { "openai/resource": { path: "/work/hidden/app.ts" } },
        )
      ).isError,
    ).toBe(true);
    expect((await call("exeora_resolve_file", { file })).isError).toBe(true);
  });
});

describe("persisted native settings", () => {
  it("returns defaults for every property and applies partial updates without erasing others", async () => {
    const first = await call("exeora_settings_read");
    const data = first.structuredContent as {
      schema: { properties: Record<string, unknown> };
      values: Record<string, unknown>;
    };
    expect(Object.keys(data.values).sort()).toEqual(Object.keys(data.schema.properties).sort());
    expect(
      (
        await call("exeora_settings_update", {
          set: { defaultProject: "allowed", defaultWorkspace: "feature", showIgnored: true },
        })
      ).isError,
    ).not.toBe(true);
    await call("exeora_settings_update", { set: { diffStyle: "split" } });
    expect(await readPluginSettings(env, props)).toMatchObject({
      defaultProject: "allowed",
      defaultWorkspace: "feature",
      showIgnored: true,
      diffStyle: "split",
    });
    expect((await call("exeora_open_panel")).structuredContent).toMatchObject({
      projectId: PROJECT,
      workspace: "feature",
    });
  });
  it("isolates client and endpoint preferences and atomically merges concurrent patches", async () => {
    await Promise.all([
      updatePluginSettings(env, props, { showIgnored: true }),
      updatePluginSettings(env, props, { diffStyle: "split" }),
    ]);
    expect(await readPluginSettings(env, props)).toMatchObject({
      showIgnored: true,
      diffStyle: "split",
    });
    expect(await readPluginSettings(env, { ...props, clientId: "another" })).toMatchObject({
      showIgnored: false,
      diffStyle: "unified",
    });
    expect(await readPluginSettings(env, props, PROJECT)).toMatchObject({ showIgnored: false });
  });
  it("rejects unknown fields and projects outside the grant", async () => {
    expect((await call("exeora_settings_update", { set: { secret: "value" } })).isError).toBe(true);
    expect(
      (await call("exeora_settings_update", { set: { defaultProject: "hidden" } })).isError,
    ).toBe(true);
    expect(
      (await call("exeora_settings_update", { set: { defaultWorkspace: "feature" } })).isError,
    ).toBe(true);
  });
  it("recovers stale defaults and clears the workspace when the default project changes", async () => {
    await updatePluginSettings(env, props, {
      defaultProject: "missing-project",
      defaultWorkspace: "old-workspace",
    });
    expect((await call("exeora_open_panel")).structuredContent).toMatchObject({
      projectId: null,
      workspace: null,
    });
    expect(
      (await call("exeora_settings_update", { set: { diffStyle: "split" } })).isError,
    ).not.toBe(true);
    const changed = await call("exeora_settings_update", { set: { defaultProject: "allowed" } });
    expect(changed.structuredContent).toMatchObject({
      values: { defaultProject: "allowed", defaultWorkspace: "", diffStyle: "split" },
    });
    await updatePluginSettings(env, props, { defaultWorkspace: "deleted-workspace" });
    expect((await call("exeora_open_panel")).structuredContent).toMatchObject({
      projectId: PROJECT,
      workspace: "main",
    });
    expect((await call("exeora_open_panel", { workspace: "deleted-workspace" })).isError).toBe(
      true,
    );
  });
});

describe("panel authorization", () => {
  it("lists workspaces on another machine when the project has no default root", async () => {
    await nowhereStatement(env, USER).run();
    await db(env)
      .update(schema.projects)
      .set({ deviceId: nowhereId(USER) })
      .where(eq(schema.projects.id, PROJECT));
    await db(env)
      .update(schema.workspaces)
      .set({ deviceId: "dev_plugin_extensions" })
      .where(eq(schema.workspaces.id, "wsp_plugin_extensions"));
    const access = new PluginAccess(env as Env, props);
    const list = await panelRequest(access, {
      path: `/api/projects/${PROJECT}/workspaces`,
      method: "GET",
    });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject([{ slug: "feature" }]);
    expect(
      (
        await panelRequest(access, {
          path: `/api/projects/${PROJECT}/workspace/capabilities?workspace=feature`,
          method: "GET",
        })
      ).status,
    ).toBe(200);
  });
  it("issues log sockets bound to the sandbox origin, with one-use tickets", async () => {
    const access = new PluginAccess(env as Env, props);
    const origin = "https://exeora.web-sandbox.oaiusercontent.com";
    const issue = () =>
      panelRequest(access, {
        path: `/api/projects/${PROJECT}/logs-ticket`,
        method: "POST",
        origin,
      });
    const connect = (url: string, socketOrigin: string) =>
      worker.fetch(
        new Request(url, { headers: { Upgrade: "websocket", Origin: socketOrigin } }),
        env as Env,
        createExecutionContext(),
      );
    const denied = await issue();
    expect(denied.status).toBe(200);
    expect(
      (await connect((denied.body as { url: string }).url, "https://evil.example")).status,
    ).toBe(403);
    const fresh = await issue();
    const url = (fresh.body as { url: string }).url;
    const opened = await connect(url, origin);
    expect(opened.status).toBe(101);
    opened.webSocket?.accept();
    opened.webSocket?.close(1000, "done");
    expect((await connect(url, origin)).status).toBe(403);
  });
  it("filters project and machine lists to the grant without issuing credentials", async () => {
    const access = new PluginAccess(env as Env, props);
    const projects = await panelRequest(access, { path: "/api/projects", method: "GET" });
    expect((projects.body as { id: string }[]).map((row) => row.id)).toEqual([PROJECT]);
    const machines = await panelRequest(access, { path: "/api/machines", method: "GET" });
    const listed = (machines.body as { machines: { projects: { projectId: string }[] }[] })
      .machines;
    expect(listed.flatMap((machine) => machine.projects).map((row) => row.projectId)).toEqual([
      PROJECT,
    ]);
    expect(
      (
        await panelRequest(access, {
          path: `/api/projects/${PROJECT}/git-credential`,
          method: "POST",
        })
      ).status,
    ).toBe(403);
    await expect(
      panelRequest(access, { path: `/api/projects/${OTHER}/workspaces`, method: "GET" }),
    ).rejects.toThrow();
  });
  it("refuses project writes and interactive terminals under a restrictive policy", async () => {
    await db(env)
      .update(schema.projects)
      .set({
        commandPolicy: JSON.stringify({
          mode: "read_only",
          allow: [],
          deny: [],
          shell: false,
          approve: false,
          tools: null,
        }),
      })
      .where(eq(schema.projects.id, PROJECT));
    const access = new PluginAccess(env as Env, props);
    expect(
      (
        await panelRequest(access, {
          path: `/api/projects/${PROJECT}/workspace/actions`,
          method: "POST",
          body: { action: "file_write", path: "app.ts", content: "changed" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await panelRequest(access, {
          path: `/api/projects/${PROJECT}/terminal-ticket`,
          method: "POST",
          origin: "https://exeora.web-sandbox.oaiusercontent.com",
        })
      ).status,
    ).toBe(403);
  });
  it("does not restore readers excluded from the connection tool allowlist", async () => {
    await db(env)
      .update(schema.projects)
      .set({ commandPolicy: JSON.stringify({ mode: "allow_all", tools: [] }) })
      .where(eq(schema.projects.id, PROJECT));
    const access = new PluginAccess(env as Env, props);
    for (const body of [
      { action: "file_read", path: "app.ts" },
      { action: "tree", path: "." },
      { action: "search", query: "private" },
    ]) {
      expect(
        (
          await panelRequest(access, {
            path: `/api/projects/${PROJECT}/workspace/reads`,
            method: "POST",
            body,
          })
        ).status,
      ).toBe(403);
    }
    for (const route of [
      { path: `/api/projects/${PROJECT}/logs-ticket`, method: "POST" },
      { path: `/api/projects/${PROJECT}/workspace/capabilities`, method: "GET" },
    ]) {
      expect(
        (
          await panelRequest(access, {
            ...route,
            origin: "https://exeora.web-sandbox.oaiusercontent.com",
          })
        ).status,
      ).toBe(403);
    }
  });
  it("refuses access after revocation and never trusts a file URI as a path", async () => {
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.id, "pcl_plugin_extensions"));
    expect((await call("exeora_open_panel", { project: "allowed" })).isError).toBe(true);
    expect(
      (
        await call("exeora_resolve_file", {
          file: { name: "app.ts", resourceUri: "file:///work/allowed/app.ts" },
        })
      ).isError,
    ).toBe(true);
    const list = await panelRequest(new PluginAccess(env as Env, props), {
      path: "/api/projects",
      method: "GET",
    });
    expect(list.body).toEqual([]);
  });
});

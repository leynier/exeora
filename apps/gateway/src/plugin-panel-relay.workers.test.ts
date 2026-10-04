import { createExecutionContext, env } from "cloudflare:test";
import { RelayCommand } from "@exeora/protocol/panel-relay";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api/index.js";
import { db, schema } from "./db/client.js";
import worker from "./index.js";
import { closePanelSockets, dialPanel, PANEL_ORIGIN, panelState } from "./panel-relay-fixtures.js";
import { panelSockets } from "./panel-relay-routes.js";
import {
  CLIENT,
  PROJECT,
  pluginEnv,
  setupPluginFixture,
  USER,
} from "./plugin-extensions-fixtures.js";
import { call, post } from "./plugin-wire-fixtures.js";

beforeEach(setupPluginFixture);
afterEach(closePanelSockets);
async function opening() {
  const result = await call("exeora_open_panel", { project: PROJECT, workspace: "feature" });
  const panelId = result.structuredContent?.panelId as string;
  expect(panelId).toMatch(/^[0-9a-f-]{36}$/);
  return {
    panelId,
    relay: env.WORKSPACE_PANEL_RELAY.getByName(panelId),
    principal: { userId: USER, clientId: CLIENT, endpoint: "account" },
  };
}

describe("public server navigation without instance-tool discovery", () => {
  it("advertises ordinary public tools and private ticket/resolver on both MCP endpoints and protocol versions", async () => {
    for (const modern of [false, true])
      for (const project of [undefined, PROJECT]) {
        const body = await post("tools/list", {}, project, modern);
        const tools = (
          body.result as {
            tools: {
              name: string;
              description?: string;
              _meta?: unknown;
              inputSchema: { required?: string[] };
            }[];
          }
        ).tools;
        for (const name of ["exeora_workspace_get_state", "exeora_workspace_navigate"]) {
          const tool = tools.find((value) => value.name === name);
          expect(tool?.description).toContain("panelId");
          expect(tool?.inputSchema.required).toContain("panelId");
          expect(tool?._meta).toBeUndefined();
        }
        for (const name of ["exeora_panel_relay_ticket", "exeora_panel_resolve_navigation"]) {
          expect(tools.find((value) => value.name === name)?._meta).toMatchObject({
            ui: { visibility: ["app"] },
          });
        }
      }
  });
  it("routes tab/file/diff/incremental Search commands to the original panel and returns state", async () => {
    const panel = await opening();
    const view = await dialPanel(panel);
    const targets = [
      { tab: "logs" },
      { tab: "terminal" },
      { path: "src/app.ts" },
      { diff: { path: "src/app.ts", area: "staged" } },
      { search: { regex: true } },
    ];
    for (const args of targets) {
      view.frames.length = 0;
      const pending = call("exeora_workspace_navigate", { panelId: panel.panelId, ...args });
      const command = await view.command();
      expect(RelayCommand.safeParse(command).success).toBe(true);
      expect(command.args).toEqual(args);
      expect(command.panelId).toBe(panel.panelId);
      view.reply(command, {
        status: "applied",
        state: {
          ...panelState,
          projectId: PROJECT,
          workspace: "feature",
          tab: "logs",
          dirtyPaths: ["unsaved.ts"],
        },
      });
      expect((await pending).structuredContent).toMatchObject({
        panelId: panel.panelId,
        status: "applied",
        state: { dirtyPaths: ["unsaved.ts"] },
      });
    }
    view.frames.length = 0;
    const pending = call("exeora_workspace_get_state", { panelId: panel.panelId });
    view.reply(await view.command(), {
      state: { ...panelState, projectId: PROJECT, workspace: null, tab: "terminal" },
    });
    expect((await pending).structuredContent).toMatchObject({
      panelId: panel.panelId,
      state: { tab: "terminal", workspace: null },
    });
  });
  it("rejects unknown panels, mismatched endpoints, traversal, contradictory targets and ungranted routes before dispatch", async () => {
    const panel = await opening();
    const view = await dialPanel(panel);
    expect(
      (await call("exeora_workspace_get_state", { panelId: crypto.randomUUID() })).isError,
    ).toBe(true);
    const cross = await post(
      "tools/call",
      { name: "exeora_workspace_get_state", arguments: { panelId: panel.panelId } },
      PROJECT,
    );
    expect(cross.result).toMatchObject({ isError: true });
    for (const args of [
      { path: "../secret" },
      { path: "app.ts", tab: "logs" },
      { project: "hidden" },
      { path: "app.ts", diff: { path: "app.ts" } },
    ]) {
      expect(
        (await call("exeora_workspace_navigate", { panelId: panel.panelId, ...args })).isError,
      ).toBe(true);
    }
    expect(view.frames.some((frame) => frame.type === "command")).toBe(false);
  });
  it("private resolver validates the current route without UI rendering metadata or a new panel id", async () => {
    const panel = await opening();
    const result = await call("exeora_panel_resolve_navigation", {
      panelId: panel.panelId,
      project: PROJECT,
      workspace: "main",
      tab: "logs",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      panelId: panel.panelId,
      projectId: PROJECT,
      workspace: "main",
      tab: "logs",
    });
    expect(
      (await call("exeora_panel_resolve_navigation", { project: "hidden", workspace: "main" }))
        .isError,
    ).toBe(true);
  });
  it("rechecks revoked grants after a UI acknowledgment and exposes no state", async () => {
    const panel = await opening();
    const view = await dialPanel(panel);
    const pending = call("exeora_workspace_get_state", { panelId: panel.panelId });
    const command = await view.command();
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.clientId, CLIENT));
    view.reply(command, { state: { ...panelState, projectId: PROJECT, workspace: "feature" } });
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).not.toHaveProperty("state");
  });
  it("reports queued and confirmation outcomes accurately", async () => {
    const panel = await opening();
    const view = await dialPanel(panel);
    for (const status of ["queued", "needs_confirmation", "cancelled", "superseded"] as const) {
      view.frames.length = 0;
      const pending = call("exeora_workspace_navigate", { panelId: panel.panelId, tab: "logs" });
      view.reply(await view.command(), {
        status,
        state: { ...panelState, projectId: PROJECT, workspace: "feature" },
      });
      expect((await pending).structuredContent?.status).toBe(status);
    }
  });
  it("supports versioned resources and old resource URI aliases", async () => {
    for (const uri of [
      "ui://exeora/workspace/v2",
      "ui://exeora/workspace",
      "ui://exeora/dashboard/v2",
      "ui://exeora/dashboard",
    ]) {
      expect((await post("resources/read", { uri })).result).toMatchObject({ contents: [{ uri }] });
    }
  });
});

describe("trusted plugin connection and independent Dashboard pairing", () => {
  it("limits public socket upgrades before allocating a relay", async () => {
    const response = await panelSockets.fetch(
      new Request(
        `https://exeora.dev/panel-relay/connect?panelId=${crypto.randomUUID()}&ticket=${"a".repeat(64)}`,
        { headers: { Upgrade: "websocket", Origin: PANEL_ORIGIN } },
      ),
      { ...pluginEnv, RL_AUTH: { limit: async () => ({ success: false }) } } as unknown as Env,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
  it("issues a short-lived one-use socket URL only for a trusted sandbox origin", async () => {
    const panel = await opening();
    expect(
      (await call("exeora_panel_relay_ticket", { panelId: panel.panelId, origin: "null" })).isError,
    ).toBe(true);
    expect(
      (
        await call("exeora_panel_relay_ticket", {
          panelId: panel.panelId,
          origin: "https://evil.example",
        })
      ).isError,
    ).toBe(true);
    const result = await call("exeora_panel_relay_ticket", {
      panelId: panel.panelId,
      origin: PANEL_ORIGIN,
    });
    const ticket = result.structuredContent;
    expect(ticket).toMatchObject({
      panelId: panel.panelId,
      protocol: 1,
      expiresAt: expect.any(Number),
    });
    const url = new URL(ticket?.url as string);
    expect(url.origin).toBe("wss://exeora.dev");
    expect(url.pathname).toBe("/panel-relay/connect");
    await dialPanel(panel, url.searchParams.get("ticket") as string);
    expect(
      (
        await panelSockets.fetch(
          new Request(url.toString().replace("wss:", "https:"), {
            headers: { Upgrade: "websocket", Origin: PANEL_ORIGIN },
          }),
          pluginEnv,
        )
      ).status,
    ).toBe(403);
  });
  it("requires a valid same-account Sideapp bearer; never treats a pairing ticket as a socket ticket", async () => {
    await env.OAUTH_KV.put("sideapp_client_id", "sideapp");
    const panel = await opening();
    const result = await call("exeora_panel_relay_ticket", {
      panelId: panel.panelId,
      origin: PANEL_ORIGIN,
      surface: "dashboard",
    });
    const ticket = result.structuredContent?.pairingTicket as string;
    const request = () =>
      new Request("https://exeora.dev/api/panel-relay/ticket", {
        method: "POST",
        headers: { Origin: PANEL_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ panelId: panel.panelId, ticket, origin: PANEL_ORIGIN }),
      });
    const unauthenticated = await worker.fetch(request(), pluginEnv, createExecutionContext());
    expect(unauthenticated.status).toBe(401);
    async function exchange(userId: string, clientId = "sideapp", scopes = ["dashboard:manage"]) {
      const ctx = createExecutionContext();
      (ctx as unknown as { props: unknown }).props = { userId, clientId, scopes };
      return api.fetch(request(), pluginEnv, ctx);
    }
    expect((await exchange("another")).status).toBe(403);
    expect((await exchange(USER, "dashboard")).status).toBe(403);
    expect((await exchange(USER, "sideapp", ["tools:execute"])).status).toBe(403);
    const exchanged = await exchange(USER);
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as { url: string };
    await dialPanel(panel, new URL(body.url).searchParams.get("ticket") as string);
    expect((await exchange(USER)).status).toBe(403);
  });
});

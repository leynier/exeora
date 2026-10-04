import { env, runInDurableObject } from "cloudflare:test";
import type { PanelRelayCommand, PanelRelayResult } from "@exeora/protocol/panel-relay";
import { expect } from "vitest";
import type { PanelPrincipal } from "./panel-relay-do.js";
import { eventually } from "./relay-do-fixtures.js";

export const PANEL_ORIGIN = "https://relay.web-sandbox.oaiusercontent.com";
export const panelState: PanelRelayResult["state"] = {
  projectId: null,
  workspace: null,
  tab: null,
  path: null,
  diff: null,
  openPaths: [],
  dirtyPaths: [],
  search: null,
  pendingConfirmation: null,
  lastConfirmation: null,
};
const sockets: WebSocket[] = [];
export function closePanelSockets() {
  for (const socket of sockets.splice(0)) socket.close();
}
export async function freshPanel(
  principal: PanelPrincipal = { userId: "user", clientId: "client", endpoint: "account" },
) {
  const panelId = crypto.randomUUID();
  const relay = env.WORKSPACE_PANEL_RELAY.getByName(panelId);
  await relay.register(principal, panelId);
  return { panelId, relay, principal };
}
type Panel = Awaited<ReturnType<typeof freshPanel>>;
export async function dialPanel(panel: Panel, ticket?: string, ready = true) {
  const issued = ticket
    ? { ticket }
    : await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "socket");
  if ("error" in issued) throw new Error(issued.message);
  const response = await panel.relay.fetch(
    new Request(`https://relay/connect?panelId=${panel.panelId}&ticket=${issued.ticket}`, {
      headers: { Upgrade: "websocket", Origin: PANEL_ORIGIN },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("No panel socket.");
  sockets.push(socket);
  const frames: Record<string, unknown>[] = [];
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)));
  });
  await eventually(() => expect(frames.find((value) => value.type === "ready")).toBeDefined());
  const greeting = frames.find((value) => value.type === "ready");
  if (ready) {
    socket.send(JSON.stringify({ type: "ready", protocol: 1 }));
    await eventually(async () =>
      runInDurableObject(panel.relay, (_instance, state) =>
        expect(state.getWebSockets().some((ws) => ws.deserializeAttachment()?.ready)).toBe(true),
      ),
    );
  }
  return {
    socket,
    frames,
    generation: greeting?.generation as string,
    reply(command: PanelRelayCommand, result: PanelRelayResult) {
      socket.send(
        JSON.stringify({
          type: "result",
          protocol: 1,
          requestId: command.requestId,
          generation: command.generation,
          result,
        }),
      );
    },
    async command() {
      await eventually(() => expect(frames.some((value) => value.type === "command")).toBe(true));
      return frames.find((value) => value.type === "command") as unknown as PanelRelayCommand;
    },
  };
}

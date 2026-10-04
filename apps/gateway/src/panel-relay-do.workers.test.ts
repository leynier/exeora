import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  closePanelSockets,
  dialPanel,
  freshPanel,
  PANEL_ORIGIN,
  panelState,
} from "./panel-relay-fixtures.js";
import { eventually } from "./relay-do-fixtures.js";

afterEach(closePanelSockets);
describe("Workspace instance relay in workerd", () => {
  it("bounds concurrent outstanding tickets atomically", async () => {
    const panel = await freshPanel();
    const tickets = await Promise.all(
      Array.from({ length: 24 }, () =>
        panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "socket"),
      ),
    );
    expect(tickets.filter((ticket) => "ticket" in ticket)).toHaveLength(16);
    expect(tickets.filter((ticket) => "error" in ticket)).toHaveLength(8);
  });
  it("requires ready handshake and returns the actual correlated result", async () => {
    const panel = await freshPanel();
    const view = await dialPanel(panel, undefined, false);
    expect(
      await panel.relay.command(panel.principal, "get_state", {}, crypto.randomUUID()),
    ).toMatchObject({ error: "panel_unavailable" });
    view.socket.send(JSON.stringify({ type: "ready", protocol: 1 }));
    await eventually(async () =>
      runInDurableObject(panel.relay, (_object, state) =>
        expect(state.getWebSockets()[0]?.deserializeAttachment()?.ready).toBe(true),
      ),
    );
    const pending = panel.relay.command(
      panel.principal,
      "navigate",
      { tab: "logs" },
      crypto.randomUUID(),
    );
    const command = await view.command();
    expect(command).toMatchObject({
      panelId: panel.panelId,
      operation: "navigate",
      args: { tab: "logs" },
      generation: view.generation,
      protocol: 1,
    });
    view.reply(command, { status: "applied", state: { ...panelState, tab: "logs" } });
    expect(await pending).toMatchObject({ result: { status: "applied", state: { tab: "logs" } } });
  });
  it("separates users, OAuth clients, endpoints and panels", async () => {
    const panel = await freshPanel();
    await dialPanel(panel);
    for (const changed of [{ userId: "other" }, { clientId: "other" }, { endpoint: "project" }]) {
      const principal = { ...panel.principal, ...changed };
      expect(
        await panel.relay.command(principal, "get_state", {}, crypto.randomUUID()),
      ).toMatchObject({ error: "panel_unavailable" });
      expect(await panel.relay.issueTicket(principal, PANEL_ORIGIN, "socket")).toMatchObject({
        error: "panel_unavailable",
      });
    }
    const other = await freshPanel(panel.principal);
    const view = await dialPanel(other);
    const pending = other.relay.command(other.principal, "get_state", {}, crypto.randomUUID());
    const command = await view.command();
    expect(command.panelId).toBe(other.panelId);
    view.reply(command, { state: { ...panelState } });
    await pending;
  });
  it("tickets are one-use, origin-bound, expiry-bound and limited to the intended socket kind", async () => {
    const panel = await freshPanel();
    const issued = await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "socket");
    if ("error" in issued) throw new Error(issued.message);
    await dialPanel(panel, issued.ticket);
    const request = (ticket: string, origin = PANEL_ORIGIN) =>
      new Request(`https://relay/connect?ticket=${ticket}`, {
        headers: { Upgrade: "websocket", Origin: origin },
      });
    expect((await panel.relay.fetch(request(issued.ticket))).status).toBe(403);
    const wrong = await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "socket");
    if ("error" in wrong) throw new Error(wrong.message);
    expect((await panel.relay.fetch(request(wrong.ticket, "https://evil.example"))).status).toBe(
      403,
    );
    const expired = await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "socket");
    if ("error" in expired) throw new Error(expired.message);
    await runInDurableObject(panel.relay, async (_object, state) =>
      state.storage.put(`ticket:${expired.ticket}`, {
        kind: "socket",
        origin: PANEL_ORIGIN,
        expiresAt: Date.now() - 1,
      }),
    );
    expect((await panel.relay.fetch(request(expired.ticket))).status).toBe(403);
    const pair = await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "pairing");
    if ("error" in pair) throw new Error(pair.message);
    expect((await panel.relay.fetch(request(pair.ticket))).status).toBe(403);
  });
  it("requires a matching separately authenticated Sideapp account before exchange", async () => {
    const panel = await freshPanel();
    const pair = await panel.relay.issueTicket(panel.principal, PANEL_ORIGIN, "pairing");
    if ("error" in pair) throw new Error(pair.message);
    expect(await panel.relay.exchangePairing("another", pair.ticket, PANEL_ORIGIN)).toMatchObject({
      error: "panel_unavailable",
    });
    const ticket = await panel.relay.exchangePairing(
      panel.principal.userId,
      pair.ticket,
      PANEL_ORIGIN,
    );
    expect(ticket).toHaveProperty("ticket");
    expect(
      await panel.relay.exchangePairing(panel.principal.userId, pair.ticket, PANEL_ORIGIN),
    ).toMatchObject({ error: "invalid_ticket" });
    if ("error" in ticket) throw new Error(ticket.message);
    await dialPanel(panel, ticket.ticket);
  });
  it("replacement cancels the old generation and stale replies cannot settle the new one", async () => {
    const panel = await freshPanel();
    const old = await dialPanel(panel);
    const requestId = crypto.randomUUID();
    const pending = panel.relay.command(panel.principal, "navigate", { tab: "logs" }, requestId);
    const command = await old.command();
    const next = await dialPanel(panel);
    expect(await pending).toMatchObject({ error: "panel_reconnected" });
    const current = panel.relay.command(panel.principal, "get_state", {}, requestId);
    const currentCommand = await next.command();
    next.socket.send(
      JSON.stringify({
        type: "result",
        protocol: 1,
        requestId,
        generation: command.generation,
        result: { state: { ...panelState, tab: "logs" } },
      }),
    );
    next.reply(currentCommand, { state: { ...panelState, tab: "terminal" } });
    expect(await current).toMatchObject({ result: { state: { tab: "terminal" } } });
  });
  it("cancellation propagates to the UI and never replays the navigation", async () => {
    const panel = await freshPanel();
    const view = await dialPanel(panel);
    const requestId = crypto.randomUUID();
    const pending = panel.relay.command(panel.principal, "navigate", { tab: "logs" }, requestId);
    await view.command();
    await panel.relay.cancel(panel.principal, requestId);
    expect(await pending).toMatchObject({ error: "panel_cancelled" });
    await eventually(() =>
      expect(
        view.frames.some((value) => value.type === "cancel" && value.requestId === requestId),
      ).toBe(true),
    );
    expect(
      await panel.relay.command(panel.principal, "navigate", { tab: "logs" }, requestId),
    ).toMatchObject({ error: "panel_cancelled" });
    expect(view.frames.filter((value) => value.type === "command")).toHaveLength(1);
  });
  it("timeout is an unknown outcome, sends cancel and ignores a late applied reply", async () => {
    const panel = await freshPanel();
    const view = await dialPanel(panel);
    const pending = panel.relay.command(
      panel.principal,
      "navigate",
      { tab: "logs" },
      crypto.randomUUID(),
    );
    const command = await view.command();
    expect(await pending).toMatchObject({
      error: "panel_timeout",
      message: expect.stringContaining("unknown"),
    });
    await eventually(() => expect(view.frames.some((value) => value.type === "cancel")).toBe(true));
    view.reply(command, { status: "applied", state: { ...panelState, tab: "logs" } });
    expect(view.frames.filter((value) => value.type === "command")).toHaveLength(1);
  }, 20_000);
  it("malformed replies and incompatible protocol fail closed", async () => {
    const panel = await freshPanel();
    const view = await dialPanel(panel);
    const pending = panel.relay.command(panel.principal, "get_state", {}, crypto.randomUUID());
    const command = await view.command();
    view.socket.send(
      JSON.stringify({
        type: "result",
        protocol: 1,
        requestId: command.requestId,
        generation: command.generation,
        result: { state: { secret: "never passed to model" } },
      }),
    );
    expect(await pending).toMatchObject({ error: "panel_protocol" });
    const next = await dialPanel(panel, undefined, false);
    next.socket.send(JSON.stringify({ type: "ready", protocol: 999 }));
    await eventually(async () =>
      expect(
        await panel.relay.command(panel.principal, "get_state", {}, crypto.randomUUID()),
      ).toMatchObject({ error: "panel_unavailable" }),
    );
  });
  it("expires registrations and refuses unknown commands without dispatch", async () => {
    const panel = await freshPanel();
    const view = await dialPanel(panel);
    expect(
      await panel.relay.command(panel.principal, "tap" as "navigate", {}, crypto.randomUUID()),
    ).toMatchObject({ error: "invalid_command" });
    expect(view.frames.some((value) => value.type === "command")).toBe(false);
    await runInDurableObject(panel.relay, async (_object, state) =>
      state.storage.put("registration", {
        principal: panel.principal,
        panelId: panel.panelId,
        expiresAt: Date.now() - 1,
      }),
    );
    await runDurableObjectAlarm(panel.relay);
    expect(
      await panel.relay.command(panel.principal, "get_state", {}, crypto.randomUUID()),
    ).toMatchObject({ error: "panel_unavailable" });
  });
});

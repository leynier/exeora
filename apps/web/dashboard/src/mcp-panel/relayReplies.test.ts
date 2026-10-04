import { RelayResponse } from "@exeora/protocol/panel-relay";
import { describe, expect, it, vi } from "vitest";
import type { PanelState } from "./controller.js";
import { bounded, pairedTickets, RelayUnavailable, toolTickets } from "./relay.js";

const PANEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GEN = "33333333-3333-4333-8333-333333333333";
const REQ = "55555555-5555-4555-8555-555555555555";

const STATE: PanelState = {
  projectId: "p1",
  workspace: null,
  tab: "explorer",
  path: "src/a.ts",
  diff: null,
  openPaths: ["src/a.ts"],
  dirtyPaths: [],
  search: null,
  pendingConfirmation: null,
  lastConfirmation: null,
};

describe("bounded", () => {
  it("passes a reply within the gateway's limits as it is", () => {
    const result = { status: "applied" as const, state: STATE };
    expect(bounded(result)).toEqual(result);
    expect(bounded({ message: "x".repeat(3000), state: STATE }).message).toHaveLength(2000);
  });

  it("keeps a reply within the gateway's limits, and says it is incomplete", () => {
    const many = Array.from({ length: 1500 }, (_, i) => `f${i}.ts`);
    const result = bounded({
      status: "needs_confirmation",
      message: "x".repeat(3000),
      state: {
        ...STATE,
        openPaths: many,
        dirtyPaths: [...many, "y".repeat(5000)],
        pendingConfirmation: { projectId: "p2", workspace: null, dirtyPaths: many },
      },
    });
    expect(result.status).toBe("error");
    expect(result.message).toContain("this state is incomplete");
    expect(result.message).toContain("The navigation itself was needs_confirmation.");
    expect(result.state.openPaths).toHaveLength(1000);
    expect(result.state.dirtyPaths).toHaveLength(1000);
    expect(result.state.pendingConfirmation?.dirtyPaths).toHaveLength(1000);
    expect(
      RelayResponse.parse({ type: "result", protocol: 1, requestId: REQ, generation: GEN, result }),
    ).toBeTruthy();
  });
});

describe("tickets", () => {
  const ticketAnswer = (extra: Record<string, unknown> = {}) => ({
    structuredContent: {
      panelId: PANEL,
      protocol: 1,
      url: "https://gw.test/r?t=1",
      expiresAt: 1,
      ...extra,
    },
  });

  it("asks the connection for a Workspace ticket bound to the page's origin", async () => {
    const call = vi.fn(async () => ticketAnswer());
    const ticket = await toolTickets(call, "https://sandbox.test")(PANEL);
    expect(call).toHaveBeenCalledWith("exeora_panel_relay_ticket", {
      panelId: PANEL,
      origin: "https://sandbox.test",
      surface: "workspace",
    });
    expect(ticket).toMatchObject({ panelId: PANEL, url: "https://gw.test/r?t=1" });
  });

  it("says why when the gateway refuses, and refuses another protocol outright", async () => {
    const refused = vi.fn(async () => ({
      isError: true,
      content: [{ type: "text", text: "Not your panel." }],
    }));
    await expect(toolTickets(refused, "https://s.test")(PANEL)).rejects.toThrow("Not your panel.");
    const newer = vi.fn(async () => ticketAnswer({ protocol: 2 }));
    await expect(toolTickets(newer, "https://s.test")(PANEL)).rejects.toBeInstanceOf(
      RelayUnavailable,
    );
  });

  it("pairs the Dashboard: a pairing ticket from the connection, exchanged with its sign-in", async () => {
    const call = vi.fn(async () =>
      ticketAnswer({ url: "https://gw.test/unused", pairingTicket: "pair-1" }),
    );
    const exchange = vi.fn(
      async () => ticketAnswer({ url: "https://gw.test/r?t=2" }).structuredContent,
    );
    const ticket = await pairedTickets(call, "https://s.test", exchange)(null);
    expect(call).toHaveBeenCalledWith("exeora_panel_relay_ticket", {
      origin: "https://s.test",
      surface: "dashboard",
    });
    expect(exchange).toHaveBeenCalledWith({
      panelId: PANEL,
      ticket: "pair-1",
      origin: "https://s.test",
    });
    expect(ticket.url).toBe("https://gw.test/r?t=2");
  });

  it("refuses a pairing that names no ticket, or answers for another panel", async () => {
    const unpaired = vi.fn(async () => ticketAnswer());
    const exchange = vi.fn();
    await expect(pairedTickets(unpaired, "https://s.test", exchange)(PANEL)).rejects.toThrow(
      "pairing ticket",
    );
    expect(exchange).not.toHaveBeenCalled();
    const call = vi.fn(async () => ticketAnswer({ pairingTicket: "pair-1" }));
    const other = vi.fn(async () => ticketAnswer({ panelId: OTHER }).structuredContent);
    await expect(pairedTickets(call, "https://s.test", other)(PANEL)).rejects.toBeInstanceOf(
      RelayUnavailable,
    );
  });
});

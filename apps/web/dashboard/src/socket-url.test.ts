import { describe, expect, it } from "vitest";
import { panelTicketResult } from "../../../gateway/src/plugin-panel-relay.js";
import { configureTicketOrigin, ticketSocketUrl } from "./socket-url.js";

describe("ticketSocketUrl", () => {
  const origin = "https://exeora.example";

  it("converts a same-origin HTTPS ticket to WSS", () => {
    expect(
      ticketSocketUrl("https://exeora.example/logs/connect?ticket=one", origin)?.toString(),
    ).toBe("wss://exeora.example/logs/connect?ticket=one");
  });

  it("keeps same-origin HTTP tickets usable for local development", () => {
    expect(
      ticketSocketUrl(
        "http://localhost:8787/terminal/connect?ticket=one",
        "http://localhost:8787",
      )?.toString(),
    ).toBe("ws://localhost:8787/terminal/connect?ticket=one");
  });

  it.each([
    "https://evil.example/logs/connect?ticket=one",
    "http://exeora.example/logs/connect?ticket=one",
    "wss://exeora.example/logs/connect?ticket=one",
    "/logs/connect?ticket=one",
    "not a URL",
  ])("rejects ticket URL %s", (value) => {
    expect(ticketSocketUrl(value, origin)).toBeUndefined();
  });
});

describe("configureTicketOrigin", () => {
  it("binds tickets to the configured gateway instead of the page", () => {
    configureTicketOrigin("https://exeora.dev");
    try {
      expect(ticketSocketUrl("https://exeora.dev/terminal/connect?ticket=one")?.toString()).toBe(
        "wss://exeora.dev/terminal/connect?ticket=one",
      );
      expect(
        ticketSocketUrl("https://sandbox.example/terminal/connect?ticket=one"),
      ).toBeUndefined();
    } finally {
      configureTicketOrigin(null);
    }
  });
});

describe("the gateway's panel relay tickets", () => {
  // The gateway's own ticket answer, through the panel's own policy: an
  // HTTP(S) ticket URL on the gateway, which the panel turns into the socket.
  const panelId = "7d0f2c8e-4a51-4b8e-9b0e-1f2a3b4c5d6e";
  const ticket = { ticket: "one-use", expiresAt: 1_900_000_000_000 };
  const env = (base: string) =>
    ({ EXEORA_BASE_URL: base }) as unknown as Parameters<typeof panelTicketResult>[0];

  it.each([
    ["https://exeora.example", "wss:"],
    ["http://localhost:8787", "ws:"],
  ])("opens a Workspace or exchanged Sideapp ticket from %s as %s", (base, scheme) => {
    const origin = new URL(base).origin;
    // The Workspace's ticket and the Sideapp's exchanged one share this shape.
    const result = panelTicketResult(env(base), panelId, ticket);
    const socket = ticketSocketUrl(result.url, origin);
    expect(socket?.protocol).toBe(scheme);
    expect(socket?.origin.replace(/^ws/, "http")).toBe(origin);
    expect(socket?.searchParams.get("ticket")).toBe("one-use");
    expect(socket?.searchParams.get("panelId")).toBe(panelId);
  });

  it.each(["https://exeora.example", "http://localhost:8787"])(
    "gives the Sideapp's pairing from %s no socket ticket",
    (base) => {
      const result = panelTicketResult(env(base), panelId, ticket, true);
      expect(result.pairingTicket).toBe("one-use");
      expect(new URL(result.url).searchParams.has("ticket")).toBe(false);
      expect(result.url).not.toContain("one-use");
    },
  );
});

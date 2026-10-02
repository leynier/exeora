import { describe, expect, it } from "vitest";
import { ticketSocketUrl } from "./socket-url.js";

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

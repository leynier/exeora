import { describe, expect, it, vi } from "vitest";
import { normalizeGateway, whatIsLost } from "./gateway.js";

// The module reaches the `conf` store through its imports, and a test has no
// business touching the developer's real configuration to read two functions
// that never look at it.
vi.mock("./config.js", () => ({
  config: { get: () => undefined, set: () => {} },
  forgetLocalState: () => {},
  gatewayUrl: () => "https://exeora.dev",
  projects: () => [],
  setGatewayUrl: () => {},
}));

describe("normalizeGateway", () => {
  it("assumes https for a bare host", () => {
    expect(normalizeGateway("exeora.example.com")).toBe("https://exeora.example.com");
  });

  it("drops a trailing slash, a query and a fragment", () => {
    expect(normalizeGateway("https://exeora.example.com/")).toBe("https://exeora.example.com");
    expect(normalizeGateway("https://exeora.example.com/?a=1#b")).toBe(
      "https://exeora.example.com",
    );
  });

  it("lowercases the host and keeps a non-standard port", () => {
    expect(normalizeGateway("https://Exeora.Example.COM:8443")).toBe(
      "https://exeora.example.com:8443",
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(normalizeGateway("  https://exeora.example.com  ")).toBe("https://exeora.example.com");
  });

  it("keeps plain http on the loopback, where the dev gateway lives", () => {
    expect(normalizeGateway("http://localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeGateway("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("assumes http rather than https for a bare loopback address", () => {
    expect(normalizeGateway("localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeGateway("127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("refuses plain http anywhere else", () => {
    expect(() => normalizeGateway("http://exeora.example.com")).toThrow(/plain http/);
  });

  it("refuses a scheme that is not http or https", () => {
    expect(() => normalizeGateway("ftp://exeora.example.com")).toThrow(/http or https/);
  });

  it("refuses a path rather than silently dropping it", () => {
    expect(() => normalizeGateway("https://example.com/exeora")).toThrow(/has a path/);
  });

  it("refuses nothing at all", () => {
    expect(() => normalizeGateway("")).toThrow(/base URL/);
    expect(() => normalizeGateway("   ")).toThrow(/base URL/);
  });

  it("refuses something that is not a URL", () => {
    expect(() => normalizeGateway("https://")).toThrow(/is not a URL/);
  });
});

describe("whatIsLost", () => {
  it("says nothing about an install with nothing set up", () => {
    expect(whatIsLost({ deviceName: undefined, projectCount: 0, signedIn: false })).toEqual([]);
  });

  it("counts only the session when that is all there is", () => {
    expect(whatIsLost({ deviceName: undefined, projectCount: 0, signedIn: true })).toEqual([
      "the stored session",
    ]);
  });

  it("names the machine and pluralises the projects", () => {
    expect(whatIsLost({ deviceName: "blackbox", projectCount: 1, signedIn: false })).toEqual([
      "this machine's registration as blackbox",
      "1 registered project",
    ]);
    expect(whatIsLost({ deviceName: "blackbox", projectCount: 3, signedIn: false })).toEqual([
      "this machine's registration as blackbox",
      "3 registered projects",
    ]);
  });

  it("lists all three when the install is fully set up", () => {
    expect(whatIsLost({ deviceName: "blackbox", projectCount: 2, signedIn: true })).toEqual([
      "this machine's registration as blackbox",
      "2 registered projects",
      "the stored session",
    ]);
  });
});

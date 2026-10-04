import { describe, expect, it } from "vitest";
import { sideappPreflight, withSideappCors } from "./sideapp-cors.js";

const origin = "https://exeora.web-sandbox.oaiusercontent.com";
const request = (path: string, headers: Record<string, string> = {}, method = "OPTIONS") =>
  new Request(`https://exeora.dev${path}`, {
    method,
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Authorization, Content-Type",
      ...headers,
    },
  });

describe("Sideapp CORS", () => {
  it("permits exact trusted sandbox origins, supported paths and bearer headers", () => {
    for (const path of [
      "/api/projects",
      "/oauth/device/code",
      "/oauth/device/token",
      "/oauth/token",
    ]) {
      const response = sideappPreflight(request(path));
      expect(response?.status).toBe(204);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response?.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    }
    expect(
      sideappPreflight(request("/oauth/sideapp-client", { "Access-Control-Request-Method": "GET" }))
        ?.status,
    ).toBe(204);
  });

  it("does not expose other origins, OAuth browser screens, MCP routes or cookies", () => {
    for (const invalid of [
      "null",
      "https://evil.example",
      "https://exeora.web-sandbox.oaiusercontent.com.evil.example",
      "http://exeora.web-sandbox.oaiusercontent.com",
      `${origin}:443`,
    ])
      expect(sideappPreflight(request("/api/projects", { Origin: invalid }))).toBeUndefined();
    for (const path of [
      "/oauth/authorize",
      "/oauth/device",
      "/mcp",
      "/p/project/mcp",
      "/internal/maintenance",
    ])
      expect(sideappPreflight(request(path))).toBeUndefined();
    expect(
      sideappPreflight(request("/api/projects", { "Access-Control-Request-Headers": "Cookie" }))
        ?.status,
    ).toBe(403);
    expect(
      sideappPreflight(request("/api/projects", { "Access-Control-Request-Method": "TRACE" }))
        ?.status,
    ).toBe(403);
  });

  it("preserves API errors and cache variation without sharing credentials", () => {
    const response = withSideappCors(
      request("/api/projects", {}, "GET"),
      new Response("unauthorized", {
        status: 401,
        headers: { Vary: "Accept", "Access-Control-Allow-Credentials": "true" },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Accept, Origin");
  });
});

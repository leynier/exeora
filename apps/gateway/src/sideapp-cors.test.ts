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
      expect(sideappPreflight(request("/api/projects", { Origin: invalid }))?.status).toBe(403);
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

  it("removes provider CORS grants from account API responses for untrusted origins", () => {
    const response = withSideappCors(
      request("/api/projects", { Origin: "https://evil.example" }, "GET"),
      new Response("unauthorized", {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "https://evil.example",
          "Access-Control-Allow-Headers": "Authorization, *",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Expose-Headers": "WWW-Authenticate",
          Vary: "Accept",
        },
      }),
    );
    expect(response.status).toBe(401);
    expect([...response.headers.keys()].filter((key) => key.startsWith("access-control-"))).toEqual(
      [],
    );
    expect(response.headers.get("Vary")).toBe("Accept, Origin");
  });

  it("keeps the configured dashboard and Chrome extension UI origins", () => {
    const env = {
      EXEORA_BASE_URL: "https://exeora.dev",
      EXEORA_EXTENSION_IDS: "a".repeat(32),
    } as Pick<Env, "EXEORA_BASE_URL" | "EXEORA_EXTENSION_IDS">;
    for (const allowed of [
      "https://exeora.dev",
      `chrome-extension://${env.EXEORA_EXTENSION_IDS}`,
    ]) {
      const response = sideappPreflight(request("/api/projects", { Origin: allowed }), env);
      expect(response?.status).toBe(204);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
    }
    expect(
      sideappPreflight(
        request("/api/projects", { Origin: `chrome-extension://${"b".repeat(32)}` }),
        env,
      )?.status,
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

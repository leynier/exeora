import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { consentResponse, gatewayResponse } from "./gateway-response.js";

describe("gateway response protections", () => {
  it("prevents caching of authenticated errors and preserves OAuth challenges", async () => {
    const response = await SELF.fetch("https://exeora.dev/api/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("protects consent pages from scripts, framing and referrer disclosure", async () => {
    const request = new Request("https://exeora.dev/oauth/authorize");
    const response = gatewayResponse(
      request,
      new Response("<form></form>", {
        headers: { "Content-Type": "text/html", "Set-Cookie": "session=test; HttpOnly" },
      }),
    );
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBe("session=test; HttpOnly");
    expect(await response.text()).toBe("<form></form>");
  });

  it("lets a consent form end in a redirect to the client's own origin", async () => {
    const policy = async (redirectUri: string) =>
      gatewayResponse(
        new Request("https://exeora.dev/oauth/authorize"),
        await consentResponse(
          new Response("<form></form>", { headers: { "Content-Type": "text/html" } }),
          redirectUri,
        ),
      ).headers.get("Content-Security-Policy");

    const chatgpt = await policy("https://chatgpt.com/connector/oauth/abc?x=1");
    expect(chatgpt).toContain("form-action 'self' https://chatgpt.com;");
    expect(chatgpt).toContain("script-src 'none'");
    expect(await policy("http://127.0.0.1:33418/callback")).toContain(
      "form-action 'self' http://127.0.0.1:33418;",
    );
    expect(await policy("cursor://anysphere.cursor-mcp/oauth/callback")).toContain(
      "form-action 'self' cursor:;",
    );
    expect(await policy("http://[::1]:8080/cb")).toContain("form-action 'self' http:;");
    expect(await policy("not a url")).toContain("form-action 'self';");
  });

  it("keeps immutable public assets cacheable and local HTTP development usable", () => {
    const response = gatewayResponse(
      new Request("http://localhost:8787/dashboard/assets/main-abcdef12.js"),
      new Response("export {}", { headers: { "Cache-Control": "public, immutable" } }),
    );
    expect(response.headers.get("Cache-Control")).toBe("public, immutable");
    expect(response.headers.has("Strict-Transport-Security")).toBe(false);
    expect(response.headers.has("Content-Security-Policy")).toBe(false);
  });

  it("preserves WebSocket upgrade identity and socket metadata", () => {
    const pair = new WebSocketPair();
    pair[1].accept();
    const response = new Response(null, { status: 101, webSocket: pair[0] });
    expect(gatewayResponse(new Request("https://exeora.dev/api/relay/dev"), response)).toBe(
      response,
    );
    expect(response.webSocket).toBe(pair[0]);
    pair[1].close(1000);
  });
});

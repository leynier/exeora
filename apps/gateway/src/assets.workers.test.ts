import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { serveAssets } from "./assets.js";

/**
 * Serving the static site, against the real Static Assets binding.
 *
 * These run under workerd with the built site behind `env.ASSETS`, which is the
 * only way to catch the conditional-request behaviour: a browser that already
 * holds an asset revalidates it, and the binding answers 304. Nothing about
 * that shows up on a first visit, so it needs a test rather than a look.
 */

const ORIGIN = "https://exeora.dev";

const get = (path: string, headers: Record<string, string> = {}) =>
  serveAssets(new Request(`${ORIGIN}${path}`, { headers }), env);

async function assetPathFromShell(): Promise<string> {
  const html = await (await get("/dashboard/")).text();
  const match = html.match(/\/dashboard\/assets\/[^"]+\.js/);
  if (!match) throw new Error("the dashboard shell references no script");
  return match[0];
}

describe("static files", () => {
  it("serves the landing at the root", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    // Asserted on the title rather than on a headline: this test exists to
    // prove the root is the landing and not the dashboard shell, and pinning
    // it to marketing copy breaks it every time a sentence is reworded.
    expect(await response.text()).toContain("<title>Exeora:");
  });

  it("serves the dashboard shell", async () => {
    const response = await get("/dashboard/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Dashboard");
  });

  it("redirects /dashboard to the canonical trailing slash", async () => {
    expect((await get("/dashboard")).status).toBe(308);
  });

  it("404s off the dashboard rather than serving the SPA everywhere", async () => {
    expect((await get("/nope")).status).toBe(404);
  });
});

describe("client routes", () => {
  it("serves the shell for a deep link", async () => {
    const response = await get("/dashboard/devices/abc");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Dashboard");
  });

  it("keeps the OAuth callback on 200 so its query string survives", async () => {
    // Static Assets answers this with a 307 towards a trailing slash. Following
    // that redirect would drop ?code=, and sign-in would fail.
    const response = await get("/dashboard/callback?code=abc&state=xyz");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Dashboard");
  });

  it("serves a shell with a body even when the request is conditional", async () => {
    // Forwarding If-None-Match to the shell fetch would return 304 with an
    // empty body, which this wraps in a 200: a blank page.
    const response = await get("/dashboard/devices", { "If-None-Match": '"anything"' });
    expect(response.status).toBe(200);
    expect((await response.text()).length).toBeGreaterThan(0);
  });
});

describe("revalidation", () => {
  it("never answers a script request with HTML", async () => {
    const scriptPath = await assetPathFromShell();

    const fresh = await get(scriptPath);
    expect(fresh.status).toBe(200);
    const etag = fresh.headers.get("etag");
    expect(etag).toBeTruthy();

    // What a browser sends on the second visit. Answering it with the shell is
    // what left the dashboard blank until a reload.
    const revalidated = await get(scriptPath, { "If-None-Match": etag as string });

    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("passes a revalidated document through as 304", async () => {
    const fresh = await get("/dashboard/");
    const etag = fresh.headers.get("etag");
    if (!etag) return; // the binding did not offer one; nothing to assert

    expect((await get("/dashboard/", { "If-None-Match": etag })).status).toBe(304);
  });
});

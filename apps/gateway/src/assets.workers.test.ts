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
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const html = await response.text();
    // Asserted on the title rather than on a headline: this test exists to
    // prove the root is the landing and not the dashboard shell, and pinning
    // it to marketing copy breaks it every time a sentence is reworded.
    expect(html).toContain("<title>Exeora</title>");
    expect(html).toContain("Google Sign-In is optional");
    expect(html).toContain('href="/privacy/"');
  });

  it("serves the dashboard shell", async () => {
    const response = await get("/dashboard/");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    const directives = csp.split("; ");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(directives).toContain("connect-src 'self' wss://exeora.dev");
    expect(directives).not.toContain("connect-src 'self' wss:");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(await response.text()).toContain("<title>Dashboard");
  });

  it("redirects /dashboard to the canonical trailing slash", async () => {
    expect((await get("/dashboard")).status).toBe(308);
  });

  it("404s off the dashboard rather than serving the SPA everywhere", async () => {
    expect((await get("/nope")).status).toBe(404);
  });

  it("gives that 404 the landing's own page rather than an empty body", async () => {
    // `not_found_handling: none` means Static Assets hands the 404 back for
    // this Worker to answer, so the page has to be fetched by hand. Skipping
    // that is invisible until someone mistypes a URL.
    const response = await get("/nope");

    expect(response.headers.get("content-type") ?? "").toContain("text/html");
    expect(await response.text()).toContain("<title>Not found");
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
  it("caches hashed Astro assets for the lifetime of that version", async () => {
    const response = await get("/_astro/install-platform.BcEVqyp9.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

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
    expect(revalidated.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not mark a missing hashed asset's SPA fallback immutable", async () => {
    const response = await get("/dashboard/assets/missing-abcdefgh.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/html");
    expect(response.headers.get("cache-control")).not.toBe("public, max-age=31536000, immutable");
  });

  it("passes a revalidated document through as 304", async () => {
    const fresh = await get("/dashboard/");
    const etag = fresh.headers.get("etag");
    if (!etag) return; // the binding did not offer one; nothing to assert

    expect((await get("/dashboard/", { "If-None-Match": etag })).status).toBe(304);
  });
});

describe("the extension's side panel", () => {
  it("serves the panel page rather than the dashboard shell", async () => {
    const response = await get("/dashboard/panel");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Exeora</title>");
    expect(html).not.toContain("<title>Dashboard");
  });

  it("lets only the allowed extensions frame it", async () => {
    // It hands whatever frames it the questions that get an access token
    // back, so a website must not be able to frame it at all.
    const response = await get("/dashboard/panel");
    expect(response.headers.get("content-security-policy")).toContain(
      `frame-ancestors chrome-extension://${env.EXEORA_EXTENSION_IDS}`,
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' wss://exeora.dev",
    );
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("'wasm-unsafe-eval'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is framable by nothing when the gateway allows no extension", async () => {
    const off = { ...env, EXEORA_EXTENSION_IDS: "" } as unknown as Env;
    const response = await serveAssets(new Request(`${ORIGIN}/dashboard/panel`), off);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("uses a ws origin for an HTTP development request", async () => {
    const response = await serveAssets(new Request("http://localhost:8787/dashboard/"), env);
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' ws://localhost:8787",
    );
  });
});

import "./env.js";
import { extensionOrigins } from "./oauth/clients.js";

/**
 * Serves the two static builds that make up the site.
 *
 *   /            the Astro landing (a real HTML file per page)
 *   /dashboard/  the React SPA
 *
 * They live in the gateway rather than a Worker of their own because neither
 * needs a server: Astro emits static output and the dashboard is a Vite bundle
 * that talks to this same origin. One Worker means one deployment, one
 * hostname, and no splitting a domain across Workers by path.
 *
 * This runs as the fall-through of the OAuth provider's default handler, after
 * the authorization screens and before nothing at all, so an unmatched path
 * gets the landing's own 404.
 */

const DASHBOARD_PREFIX = "/dashboard";

/** Headers that are safe for both HTML and static data. */
const COMMON_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

/**
 * The dashboard shell has no inline scripts. Keeping its policy here (rather
 * than on the OAuth pages) prevents an unrelated static page from becoming a
 * script gadget while leaving the provider's framing and callback responses
 * untouched.
 */
/**
 * Vite and Astro put content hashes in these names. A long cache lifetime is
 * safe for them and keeps every dashboard navigation from revalidating its
 * JavaScript and CSS after a deploy; HTML remains revalidated so new chunks
 * are discovered promptly.
 */
const IMMUTABLE_ASSET =
  /^\/(?:dashboard\/assets|_astro)\/[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

/** Exeora for Chrome's side panel, which the extension frames from here. */
const PANEL_PATHS = new Set([`${DASHBOARD_PREFIX}/panel`, `${DASHBOARD_PREFIX}/panel.html`]);

// Narrowed to the bindings this needs, rather than the whole Env: the
// OAUTH_PROVIDER field is injected at runtime and absent from the generated
// bindings type, so asking for all of Env would make this untestable.
export async function serveAssets(
  request: Request,
  env: Pick<Env, "ASSETS" | "EXEORA_EXTENSION_IDS">,
): Promise<Response> {
  const url = new URL(request.url);

  if (PANEL_PATHS.has(url.pathname)) {
    return framedByExtension(await env.ASSETS.fetch(request), env, url);
  }

  if (url.pathname === DASHBOARD_PREFIX) {
    return withSecurityHeaders(Response.redirect(`${url.origin}${DASHBOARD_PREFIX}/`, 308));
  }

  if (url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
    const asset = await env.ASSETS.fetch(request);

    // A real file, or a revalidation of one the browser already holds.
    //
    // 304 has to pass through, and testing `asset.ok` alone does not let it:
    // `ok` is 200-299 only. Treating a revalidation as a miss answers a script
    // request with the HTML shell, the browser fails to parse that as a module,
    // and the page renders blank until a reload skips revalidation entirely.
    if (asset.ok || asset.status === 304) return withAssetHeaders(asset, url.pathname, url);

    // Anything left is a client route. Static Assets answers those with a 307
    // towards a trailing slash, and following it would strip the OAuth query
    // string, so the shell is fetched explicitly. It is fetched as
    // `${DASHBOARD_PREFIX}/` rather than `/index.html` because the explicit
    // index filename redirects to the canonical directory URL.
    //
    // Conditional headers are dropped for the same reason as above: carried
    // over, they let the shell come back 304 with an empty body, which would
    // then be served as a 200 and render blank.
    const headers = new Headers(request.headers);
    headers.delete("If-None-Match");
    headers.delete("If-Modified-Since");

    const shell = await env.ASSETS.fetch(
      new Request(`${url.origin}${DASHBOARD_PREFIX}/`, { headers }),
    );
    // Re-wrapped so a client route answers 200 rather than inheriting a status
    // that would make the SPA look like a missing page.
    return withAssetHeaders(
      new Response(shell.body, { status: 200, headers: shell.headers }),
      `${DASHBOARD_PREFIX}/`,
      url,
    );
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return withAssetHeaders(asset, url.pathname, url);

  // `not_found_handling` is set to `none` so this Worker decides the fallback,
  // which leaves the landing's own 404 page to be served by hand. Without this
  // a mistyped URL gets an empty body.
  //
  // Requested as `/404` rather than `/404.html`: Static Assets answers the
  // explicit filename with a redirect to the canonical extensionless URL, and
  // a redirect is not a page.
  const page = await env.ASSETS.fetch(new Request(`${url.origin}/404`));
  return page.ok
    ? withAssetHeaders(new Response(page.body, { status: 404, headers: page.headers }), "/404", url)
    : withAssetHeaders(asset, url.pathname, url);
}

/**
 * The side panel page, framable only by the extension ids this gateway allows.
 *
 * The panel asks whatever frames it for an access token, so the page itself
 * must refuse every other parent. With the header, a page framed at all is
 * framed by one of Exeora's own extensions; with no id allowed, by nothing.
 */
function framedByExtension(
  asset: Response,
  env: Pick<Env, "EXEORA_EXTENSION_IDS">,
  requestUrl: URL,
): Response {
  const origins = extensionOrigins(env);
  return withSecurityHeaders(asset, {
    contentSecurityPolicy: contentSecurityPolicy(
      requestUrl,
      origins.length > 0 ? origins.join(" ") : "'none'",
    ),
  });
}

/** The same-origin WebSocket endpoint, explicit for browsers that do not map `'self'`. */
function websocketOrigin(url: URL): string {
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
}

function contentSecurityPolicy(url: URL, frameAncestors: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    `connect-src 'self' ${websocketOrigin(url)}`,
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

/**
 * Adds shared HTTP security headers while preserving status and conditional
 * responses. A WebSocket upgrade is returned untouched because cloning a 101
 * response can invalidate the upgrade; callers may safely apply this helper to
 * ordinary gateway responses, including OAuth/API errors and no-store pages.
 */
export function withSecurityHeaders(
  response: Response,
  options: { cacheControl?: string; contentSecurityPolicy?: string } = {},
): Response {
  if (response.status === 101) return response;

  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
    result.headers.set(name, value);
  }
  if (options.contentSecurityPolicy) {
    result.headers.set("Content-Security-Policy", options.contentSecurityPolicy);
  }
  if (options.cacheControl) result.headers.set("Cache-Control", options.cacheControl);
  return result;
}

/** Adds static-site headers without changing a 304 into a body-bearing response. */
function withAssetHeaders(response: Response, pathname: string, requestUrl: URL): Response {
  let contentSecurityPolicy: string | undefined;
  if (pathname === DASHBOARD_PREFIX || pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html"))
      contentSecurityPolicy = contentSecurityPolicyForDashboard(requestUrl);
  }

  const options: { cacheControl?: string; contentSecurityPolicy?: string } = {};
  if (contentSecurityPolicy) options.contentSecurityPolicy = contentSecurityPolicy;
  if (IMMUTABLE_ASSET.test(pathname)) {
    options.cacheControl = "public, max-age=31536000, immutable";
  }
  return withSecurityHeaders(response, options);
}

function contentSecurityPolicyForDashboard(url: URL): string {
  return contentSecurityPolicy(url, "'self'");
}

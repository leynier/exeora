import "./env.js";

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

export async function serveAssets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === DASHBOARD_PREFIX) {
    return Response.redirect(`${url.origin}${DASHBOARD_PREFIX}/`, 308);
  }

  if (url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
    const asset = await env.ASSETS.fetch(request);
    // Only a genuine hit is served as-is. A 404 is an obvious client route, but
    // so is a redirect: Static Assets answers /dashboard/callback with a 307
    // towards a trailing slash, and following that would strip the OAuth query
    // string and break sign-in.
    if (asset.ok) return asset;

    // `${DASHBOARD_PREFIX}/`, not `/index.html`: Static Assets redirects the
    // explicit index filename to the canonical directory URL, so asking for it
    // returns a 307 instead of the shell.
    const shell = await env.ASSETS.fetch(new Request(`${url.origin}${DASHBOARD_PREFIX}/`, request));
    // Re-wrapped so a client route answers 200 rather than inheriting a status
    // that would make the SPA look like a missing page.
    return new Response(shell.body, { status: 200, headers: shell.headers });
  }

  return env.ASSETS.fetch(request);
}

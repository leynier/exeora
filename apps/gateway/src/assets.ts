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

// Narrowed to the one binding this needs, rather than the whole Env: the
// OAUTH_PROVIDER field is injected at runtime and absent from the generated
// bindings type, so asking for all of Env would make this untestable.
export async function serveAssets(request: Request, env: Pick<Env, "ASSETS">): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === DASHBOARD_PREFIX) {
    return Response.redirect(`${url.origin}${DASHBOARD_PREFIX}/`, 308);
  }

  if (url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
    const asset = await env.ASSETS.fetch(request);

    // A real file, or a revalidation of one the browser already holds.
    //
    // 304 has to pass through, and testing `asset.ok` alone does not let it:
    // `ok` is 200-299 only. Treating a revalidation as a miss answers a script
    // request with the HTML shell, the browser fails to parse that as a module,
    // and the page renders blank until a reload skips revalidation entirely.
    if (asset.ok || asset.status === 304) return asset;

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
    return new Response(shell.body, { status: 200, headers: shell.headers });
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;

  // `not_found_handling` is set to `none` so this Worker decides the fallback,
  // which leaves the landing's own 404 page to be served by hand. Without this
  // a mistyped URL gets an empty body.
  //
  // Requested as `/404` rather than `/404.html`: Static Assets answers the
  // explicit filename with a redirect to the canonical extensionless URL, and
  // a redirect is not a page.
  const page = await env.ASSETS.fetch(new Request(`${url.origin}/404`));
  return page.ok ? new Response(page.body, { status: 404, headers: page.headers }) : asset;
}

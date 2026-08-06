/**
 * Serves two static builds from one Worker.
 *
 *   /            → the Astro landing (real HTML files, one per page)
 *   /dashboard/* → the React SPA
 *
 * The routing script exists because Static Assets has a single
 * `not_found_handling` setting for the whole deployment. In
 * `single-page-application` mode every unmatched path falls back to the root
 * `/index.html`, which here is the landing, so a deep link like
 * /dashboard/devices would render the marketing page instead of the app.
 */

const DASHBOARD_PREFIX = "/dashboard";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === DASHBOARD_PREFIX) {
      return Response.redirect(`${url.origin}${DASHBOARD_PREFIX}/`, 308);
    }

    if (url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
      const asset = await env.ASSETS.fetch(request);
      // Only a genuine hit is served as-is. A 404 is an obvious client route,
      // but so is a redirect: Static Assets answers /dashboard/callback with a
      // 307 towards a trailing slash, and following that would strip the OAuth
      // query string and break sign-in.
      if (asset.ok) return asset;

      // `${DASHBOARD_PREFIX}/`, not `/index.html`: Static Assets redirects the
      // explicit index filename to the canonical directory URL, so asking for
      // it returns a 307 instead of the shell.
      const shell = await env.ASSETS.fetch(
        new Request(`${url.origin}${DASHBOARD_PREFIX}/`, request),
      );
      // Re-wrapped so a client route answers 200 rather than inheriting a
      // status that would make the SPA look like a missing page.
      return new Response(shell.body, { status: 200, headers: shell.headers });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

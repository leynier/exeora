import { Hono } from "hono";
import { internal } from "./api/internal.js";
import { serveAssets } from "./assets.js";
import "./env.js";
import {
  CLI_SCOPES,
  DASHBOARD_SCOPES,
  getCliClientId,
  getDashboardClientId,
} from "./oauth/clients.js";
import { oauthRoutes } from "./oauth/routes.js";

/**
 * Everything a request without an access token can reach: the OAuth screens,
 * the archive maintenance hook, the two public client-id lookups, and then the
 * static site. Mounted as the provider's `defaultHandler`.
 */

/** Everything else: the OAuth screens, then the static site. */
export const site = new Hono<{ Bindings: Env }>();
site.route("/", oauthRoutes);

// Here rather than on `authenticated`, because the caller is a scheduled job
// holding a shared secret, not a user holding an access token. The router
// carries its own gate and 404s when the secret is unset.
site.route("/", internal);

/**
 * Tells `exeora login` which client id to use. Unauthenticated by design;
 * it reveals nothing secret, and the CLI must call it before it holds any
 * token. Under /oauth/ rather than /api/ precisely because /api/ is an
 * `apiRoute`, where the provider demands a token before any handler runs.
 */
site.get("/oauth/cli-client", async (c) =>
  c.json({
    clientId: await getCliClientId(c.env),
    authorizationEndpoint: new URL("/oauth/authorize", c.env.EXEORA_BASE_URL).toString(),
    tokenEndpoint: new URL("/oauth/token", c.env.EXEORA_BASE_URL).toString(),
    scopes: CLI_SCOPES,
  }),
);

/** The same, for the dashboard SPA, which is also a public PKCE client. */
site.get("/oauth/dashboard-client", async (c) =>
  c.json({
    clientId: await getDashboardClientId(c.env),
    authorizationEndpoint: new URL("/oauth/authorize", c.env.EXEORA_BASE_URL).toString(),
    tokenEndpoint: new URL("/oauth/token", c.env.EXEORA_BASE_URL).toString(),
    redirectUri: new URL("/dashboard/callback", c.env.EXEORA_BASE_URL).toString(),
    scopes: DASHBOARD_SCOPES,
  }),
);

// Registered last, so it only sees paths no OAuth route claimed.
site.all("*", (c) => serveAssets(c.req.raw, c.env));

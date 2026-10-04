import { Hono } from "hono";
import { internal } from "./api/internal.js";
import { serveAssets } from "./assets.js";
import "./env.js";
import { installers } from "./installers.js";
import {
  CLI_SCOPES,
  DASHBOARD_SCOPES,
  getCliClientId,
  getDashboardClientId,
  getExtensionClientId,
  getSideappClientId,
} from "./oauth/clients.js";
import { deviceRoutes } from "./oauth/device-routes.js";
import { oauthRoutes } from "./oauth/routes.js";
import { sockets } from "./site-sockets.js";

/**
 * Everything a request without an access token can reach: the OAuth screens,
 * the archive maintenance hook, the two public client-id lookups, and then the
 * static site. Mounted as the provider's `defaultHandler`.
 */

/** Everything else: the OAuth screens, then the static site. */
export const site = new Hono<{ Bindings: Env }>();
site.route("/", installers);
site.route("/", oauthRoutes);
site.route("/", deviceRoutes);

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
    deviceCodeEndpoint: new URL("/oauth/device/code", c.env.EXEORA_BASE_URL).toString(),
    deviceTokenEndpoint: new URL("/oauth/device/token", c.env.EXEORA_BASE_URL).toString(),
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

/** The Sideapp authenticates its own user through PKCE code sign-in, never through MCP. */
site.get("/oauth/sideapp-client", async (c) =>
  c.json({ client_id: await getSideappClientId(c.env) }),
);

/**
 * The same, for the Chrome extension's side panel. It computes its own
 * redirect with `chrome.identity.getRedirectURL()`, which is registered here
 * only for the ids this gateway names; 404 when it names none.
 */
site.get("/oauth/extension-client", async (c) => {
  const clientId = await getExtensionClientId(c.env);
  if (!clientId) return c.json({ error: "extension_disabled" }, 404);
  return c.json({
    clientId,
    authorizationEndpoint: new URL("/oauth/authorize", c.env.EXEORA_BASE_URL).toString(),
    tokenEndpoint: new URL("/oauth/token", c.env.EXEORA_BASE_URL).toString(),
    scopes: DASHBOARD_SCOPES,
  });
});

site.route("/", sockets);

// Registered last, so it only sees paths no OAuth route claimed.
site.all("*", (c) => serveAssets(c.req.raw, c.env));

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { internal } from "./api/internal.js";
import { relayName } from "./api/ops.js";
import { serveAssets } from "./assets.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { installers } from "./installers.js";
import {
  CLI_SCOPES,
  DASHBOARD_SCOPES,
  getCliClientId,
  getDashboardClientId,
} from "./oauth/clients.js";
import { deviceRoutes } from "./oauth/device-routes.js";
import { oauthRoutes } from "./oauth/routes.js";

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

site.get("/terminal/connect", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade.", 426);
  }
  const expectedOrigin = new URL(c.env.EXEORA_BASE_URL).origin;
  if (c.req.header("Origin") !== expectedOrigin) return c.text("Invalid origin.", 403);
  const projectId = c.req.query("projectId");
  const deviceId = c.req.query("deviceId");
  const worktreeId = c.req.query("worktreeId");
  const worktreeSlug = c.req.query("worktreeSlug");
  const ticket = c.req.query("ticket");
  const cols = Number(c.req.query("cols"));
  const rows = Number(c.req.query("rows"));
  if (
    !projectId ||
    !deviceId ||
    !ticket ||
    !/^[0-9a-f]{64}$/.test(ticket) ||
    Boolean(worktreeId) !== Boolean(worktreeSlug) ||
    !Number.isInteger(cols) ||
    cols < 20 ||
    cols > 500 ||
    !Number.isInteger(rows) ||
    rows < 5 ||
    rows > 300
  ) {
    return c.text("Invalid terminal request.", 400);
  }
  const project = await db(c.env)
    .select({ userId: schema.projects.userId })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.projects.deviceId, schema.devices.id))
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.deviceId, deviceId),
        eq(schema.devices.userId, schema.projects.userId),
        isNull(schema.devices.revokedAt),
      ),
    )
    .get();
  if (!project) return c.text("Project not found.", 404);
  if (worktreeId && worktreeSlug) {
    const worktree = await db(c.env)
      .select({ id: schema.worktrees.id })
      .from(schema.worktrees)
      .where(
        and(
          eq(schema.worktrees.id, worktreeId),
          eq(schema.worktrees.projectId, projectId),
          eq(schema.worktrees.slug, worktreeSlug),
        ),
      )
      .get();
    if (!worktree) return c.text("Worktree not found.", 404);
  }
  const relay = c.env.DEVICE_RELAY.getByName(relayName(project.userId, deviceId));
  if (
    !(await relay.consumeTerminalTicket(
      ticket,
      projectId,
      worktreeId,
      worktreeSlug,
      expectedOrigin,
    ))
  ) {
    return c.text("Terminal ticket is invalid or expired.", 403);
  }
  const url = new URL("https://relay/caller/terminal");
  url.searchParams.set("id", crypto.randomUUID());
  url.searchParams.set("projectId", projectId);
  if (worktreeId) url.searchParams.set("worktreeId", worktreeId);
  if (worktreeSlug) url.searchParams.set("worktreeSlug", worktreeSlug);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return relay.fetch(new Request(url, { headers: { Upgrade: "websocket" } }));
});

// Registered last, so it only sees paths no OAuth route claimed.
site.all("*", (c) => serveAssets(c.req.raw, c.env));

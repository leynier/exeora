import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { ExeoraError, isToolName, type ToolName } from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { api, relayName } from "./api/index.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { newId } from "./ids.js";
import { createProjectMcpHandler } from "./mcp.js";
import {
  CLI_SCOPES,
  DASHBOARD_SCOPES,
  getCliClientId,
  getDashboardClientId,
} from "./oauth/clients.js";
import { oauthRoutes } from "./oauth/routes.js";

export { DeviceRelay } from "./relay-do.js";

/**
 * Gateway Worker: OAuth authorization server, MCP endpoint, relay entry point
 * and dashboard API. The landing page and dashboard live in a separate Worker
 * (`apps/web`) so this one stays free of anything presentational.
 *
 * Routing is by path specificity on the same zone — see `routes` in
 * wrangler.jsonc. Anything not claimed here falls through to `apps/web`.
 */

type Props = { userId: string; clientId?: string };

/** Requests carrying a valid access token. */
const authenticated = new Hono<{ Bindings: Env }>();

authenticated.route("/", api);

/**
 * The CLI's outbound WebSocket. The device dials us; we never dial the device,
 * which is what removes any need for open ports, tunnels or a VPN.
 */
authenticated.get("/api/relay/:deviceId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade.", 426);
  }

  const { userId } = propsOf(c.executionCtx);
  const deviceId = c.req.param("deviceId");

  const device = await db(c.env)
    .select({ revokedAt: schema.devices.revokedAt })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
    .get();

  if (!device) return c.text("Unknown device.", 404);
  if (device.revokedAt) return c.text("This device has been revoked.", 403);

  // fetch(), not an RPC method: a Response carrying a WebSocket cannot be
  // serialised across the RPC boundary.
  const upgrade = new Request(`https://relay/connect?deviceId=${deviceId}`, {
    headers: { Upgrade: "websocket" },
  });
  return c.env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).fetch(upgrade);
});

/** One MCP endpoint per project. */
authenticated.all("/p/:projectId/mcp", async (c) => {
  const projectId = c.req.param("projectId");

  const handler = createProjectMcpHandler(projectId, async (context, tool, args) =>
    dispatchToDevice(c.env, context.userId, projectId, tool, args, context.clientId),
  );

  // `.fetch()` rather than the (request, env, ctx) form: bindings reach the
  // tools through the dispatcher closure, so the handler needs no ExecutionContext.
  return handler.fetch(c.req.raw);
});

/**
 * Resolves the project, checks it belongs to the caller, and forwards the call
 * to that project's device.
 *
 * The token is already bound to this project's resource identifier by the
 * OAuth layer, so this is the second of two independent checks rather than the
 * only one.
 */
async function dispatchToDevice(
  env: Env,
  userId: string,
  projectId: string,
  tool: ToolName,
  args: unknown,
  clientId: string | undefined,
): Promise<unknown> {
  const project = await db(env)
    .select({ deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  // Same answer whether the project does not exist or belongs to someone else:
  // distinguishing them would make project ids enumerable.
  if (!project) {
    throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }

  const startedAt = Date.now();
  try {
    const value = await env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId)).callTool({
      requestId: newId("req"),
      projectId,
      tool,
      args,
    });
    await record(env, { userId, projectId, tool, clientId, startedAt, status: "ok" });
    return value;
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool,
      clientId,
      startedAt,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
    });
    throw error;
  }
}

/** Audit row. Records what ran and how it ended — never arguments or output. */
async function record(
  env: Env,
  entry: {
    userId: string;
    projectId: string;
    tool: string;
    clientId: string | undefined;
    startedAt: number;
    status: "ok" | "error";
    errorCode?: string;
  },
): Promise<void> {
  try {
    await db(env)
      .insert(schema.toolCalls)
      .values({
        id: newId("call"),
        userId: entry.userId,
        projectId: entry.projectId,
        tool: entry.tool,
        status: entry.status,
        durationMs: Date.now() - entry.startedAt,
        errorCode: entry.errorCode ?? null,
        clientId: entry.clientId ?? null,
      })
      .run();
  } catch {
    // Auditing must never be the reason a tool call fails.
  }
}

/**
 * OAuthProvider attaches the grant's props to the ExecutionContext before
 * invoking the API handler. Typed as unknown because Hono's ExecutionContext
 * and the runtime's are structurally different.
 */
function propsOf(ctx: unknown): Props {
  return ((ctx as { props?: Props }).props ?? { userId: "" }) as Props;
}

/** Everything else: the OAuth screens, plus unauthenticated fall-through. */
const site = new Hono<{ Bindings: Env }>();
site.route("/", oauthRoutes);

/**
 * Tells `exeora login` which client id to use. Unauthenticated by design —
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

export { isToolName };

export default new OAuthProvider({
  apiRoute: ["/p/", "/api/"],
  apiHandler: authenticated,
  defaultHandler: site,

  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",

  // ChatGPT still requires Dynamic Client Registration, while the 2026-07-28
  // spec deprecates it in favour of Client ID Metadata Documents. Both are on
  // so neither class of client is locked out.
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,

  scopesSupported: ["tools:read", "tools:execute", ...CLI_SCOPES, ...DASHBOARD_SCOPES],

  // resourceMetadata.resource is deliberately left unset: the provider then
  // derives one resource identifier per path, so a token minted for
  // /p/a/mcp is not accepted at /p/b/mcp. Pinning a single value here would
  // collapse every project into one audience.
  resourceMetadata: {
    resource_name: "Exeora",
    scopes_supported: ["tools:read", "tools:execute"],
  },
});

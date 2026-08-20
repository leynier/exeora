import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { advertisedAccountTools, advertisedTools } from "./advertised.js";
import { api, relayName, runNightlyHousekeeping } from "./api/index.js";
import { reconcileAuditOutbox } from "./audit.js";
import { rememberAccountMcpClient, rememberMcpClient } from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { dispatchToDevice } from "./dispatch.js";
import { answerAccountTool, dispatchAccountCall } from "./dispatch-account.js";
import { createProjectMcpHandler, handshakeClientInfo } from "./mcp.js";
import { ACCOUNT_MCP_ROUTE, createAccountMcpHandler } from "./mcp-account.js";
import { CLI_SCOPES, DASHBOARD_SCOPES } from "./oauth/clients.js";
import {
  hasEveryScope,
  hasScope,
  inspectMcpAccess,
  insufficientScope,
  MCP_SCOPES,
} from "./oauth/scopes.js";
import { propsOf } from "./props.js";
import {
  callerAddress,
  isRateLimitedAuthPath,
  limiterFor,
  tooManyRequests,
  withinLimit,
} from "./rate-limit.js";
import { site } from "./site.js";

export { DeviceRelay } from "./relay-do.js";

/**
 * The whole of Exeora in one Worker: OAuth authorization server, MCP endpoint,
 * relay entry point, dashboard API, and the static site.
 *
 * The site was briefly a Worker of its own, on the assumption it would need a
 * framework runtime. It does not: Astro emits static HTML and the dashboard is
 * a Vite bundle. Serving both from here needs only an ASSETS binding, and it
 * removes a domain split across two Workers by path.
 *
 * What stays in this file is the wiring: the two handlers the OAuth provider
 * chooses between, the routes that decide which of them a request reached, and
 * the exports wrangler binds by name. A call's own work happens in `dispatch.ts`
 * and `dispatch-account.ts`; everything a request without a token can reach is
 * in `site.ts`.
 */

/** Requests carrying a valid access token. */
export const authenticated = new Hono<{ Bindings: Env }>();

/**
 * Per-user limits, applied here rather than in the outer wrapper because this
 * is the first point where the token has been checked and there is a user id
 * to key on. Keying these by address instead would punish an office behind one
 * NAT and let anyone with a second address around it.
 */
authenticated.use("*", async (c, next) => {
  const { userId } = propsOf(c.executionCtx);
  if (!userId) return next();

  const limiter = limiterFor(c.env, c.req.method, c.req.path);
  if (limiter && !(await withinLimit(limiter, userId))) return tooManyRequests();

  return next();
});

authenticated.route("/", api);

/**
 * The CLI's outbound WebSocket. The device dials us; we never dial the device,
 * which is what removes any need for open ports, tunnels or a VPN.
 */
authenticated.get("/api/relay/:deviceId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade.", 426);
  }

  const props = propsOf(c.executionCtx);
  if (!hasEveryScope(props, CLI_SCOPES)) return insufficientScope(CLI_SCOPES);

  const { userId } = props;
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
  const { method, required } = await inspectMcpAccess(c.req.raw.clone());
  if (!hasScope(propsOf(c.executionCtx), required)) return insufficientScope([required]);

  // The request's signal, so a client that hangs up stops the work rather than
  // leaving a command running on someone's machine for its full timeout.
  const { signal } = c.req.raw;

  // Which tools to advertise. Asked only for `tools/list`, so a tool call pays
  // neither the lookup nor the round trip to the device.
  const advertised =
    method === "tools/list"
      ? await advertisedTools(c.env, propsOf(c.executionCtx).userId, projectId)
      : undefined;

  const handler = createProjectMcpHandler(
    projectId,
    async (context, tool, args) =>
      dispatchToDevice(c.env, {
        userId: context.userId,
        projectId,
        worktree: context.worktree,
        tool,
        args,
        caller: context.caller,
        approved: context.approved,
        approvedWorktreeId: context.approvedWorktreeId,
        canElicit: context.canElicit,
        signal,
      }),
    c.env,
    advertised,
    async ({ userId }) => {
      const rows = await db(c.env)
        .select({
          slug: schema.worktrees.slug,
          name: schema.worktrees.name,
          branch: schema.worktrees.branch,
          managed: schema.worktrees.managed,
        })
        .from(schema.worktrees)
        .innerJoin(schema.projects, eq(schema.worktrees.projectId, schema.projects.id))
        .where(and(eq(schema.worktrees.projectId, projectId), eq(schema.projects.userId, userId)))
        .all();
      return { project: projectId, worktrees: rows };
    },
  );

  // Cloned, not consumed: the handler needs the body intact. The clone is read
  // only after the response is settled, so buffering the handshake never sits
  // in front of a tool call.
  const peek = c.req.raw.clone();

  // The (request, env, ctx) form, not `.fetch(request)`: the grant's props ride
  // on the ExecutionContext, and that is the only place the SDK looks for them.
  // Called without it, every tool would run with an empty user id and no
  // project would ever resolve.
  // Cast for the same reason as propsOf: Hono's ExecutionContext type and the
  // runtime's have drifted apart, though the object is the runtime's own.
  const response = await handler(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext);

  const { userId, clientId } = propsOf(c.executionCtx);
  if (userId && clientId) {
    c.executionCtx.waitUntil(
      handshakeClientInfo(peek)
        .then((info) =>
          info ? rememberMcpClient(c.env, { userId, projectId, clientId }, info) : undefined,
        )
        .catch(() => undefined),
    );
  }

  return response;
});

/**
 * The account endpoint: one URL for every project a client was given.
 *
 * Which project a call lands in is state rather than path, so it is resolved
 * per call: the `project` argument if the call named one, or the only project
 * it can reach when there is exactly one.
 */
authenticated.all(ACCOUNT_MCP_ROUTE, async (c) => {
  const { signal } = c.req.raw;
  const { userId, clientId } = propsOf(c.executionCtx);
  const { method, required } = await inspectMcpAccess(c.req.raw.clone());
  if (!hasScope(propsOf(c.executionCtx), required)) return insufficientScope([required]);

  const advertised =
    method === "tools/list" ? await advertisedAccountTools(c.env, userId, clientId) : undefined;

  const handler = createAccountMcpHandler(
    (call, tool, args) => dispatchAccountCall(c.env, call, tool, args, signal),
    (call, tool, args) => answerAccountTool(c.env, call, tool, args),
    c.env,
    advertised,
  );

  const peek = c.req.raw.clone();
  const response = await handler(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext);

  if (userId && clientId) {
    c.executionCtx.waitUntil(
      handshakeClientInfo(peek)
        .then((info) =>
          info ? rememberAccountMcpClient(c.env, { userId, clientId }, info) : undefined,
        )
        .catch(() => undefined),
    );
  }

  return response;
});

export { isToolName } from "@exeora/protocol";
export { resolveAccountProject } from "./dispatch-account.js";

const provider = new OAuthProvider({
  // Prefix matched, so `/mcp` also claims anything starting with those four
  // characters, and what it claims never reaches the static site: a path like
  // `/mcpx` is answered by the authenticated handler, which has no route for it
  // and no token to check it against. Nothing on this hostname starts that way,
  // so the reach costs nothing today, and anything added under it would have to
  // be a route here rather than a page.
  apiRoute: ["/p/", "/api/", ACCOUNT_MCP_ROUTE],
  apiHandler: authenticated,
  defaultHandler: site,

  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",

  // ChatGPT still requires Dynamic Client Registration, while the 2026-07-28
  // spec deprecates it in favour of Client ID Metadata Documents. Both are on
  // so neither class of client is locked out.
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,

  scopesSupported: [...MCP_SCOPES, ...CLI_SCOPES, ...DASHBOARD_SCOPES],

  // resourceMetadata.resource is deliberately left unset: the provider then
  // derives one resource identifier per path, so a token minted for
  // /p/a/mcp is not accepted at /p/b/mcp. Pinning a single value here would
  // collapse every project into one audience.
  resourceMetadata: {
    resource_name: "Exeora",
    scopes_supported: ["tools:read", "tools:execute"],
  },

  // The provider exposes grant props to handlers but does not expose the
  // token's effective scope. Copy the downscoped value into access-token props
  // on authorization-code exchange and every refresh.
  tokenExchangeCallback: ({ props, requestedScope }) => ({
    accessTokenProps: { ...(props as object), scopes: requestedScope },
  }),
});

/**
 * The provider wrapped rather than exported directly.
 *
 * `/oauth/token` and `/oauth/register` are answered by the provider itself,
 * before either `apiHandler` or `defaultHandler` runs, so a Hono middleware
 * never sees them and this is the only layer that can turn an unauthenticated
 * caller away. Everything else the provider does is untouched: this hands the
 * request straight on.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isRateLimitedAuthPath(new URL(request.url).pathname)) {
      if (!(await withinLimit(env.RL_AUTH, callerAddress(request)))) return tooManyRequests();
    }

    return provider.fetch(request, env, ctx);
  },

  /**
   * Nightly housekeeping. None of this belongs to a request: the audit log is
   * written by tool calls that have long since answered, the usage rollup is
   * derived from it before the prune, and expired grants are only noticed by
   * whoever tries to use one.
   *
   * The archive maintenance job reads the durable rollup checkpoint and
   * refuses to prune until it reaches yesterday. The OAuth purge is independent
   * of both archive jobs.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      reconcileAuditOutbox(env).catch((error) =>
        console.error("audit outbox reconcile failed", error),
      ),
    );

    // The frequent cron only drains the outbox. Every other scheduled event is
    // treated as nightly so local/test controllers without a cron string retain
    // the complete housekeeping behavior.
    if (_event.cron !== "*/5 * * * *") {
      ctx.waitUntil(runNightlyHousekeeping(env));
      ctx.waitUntil(
        provider
          .purgeExpiredData(env)
          .then(() => undefined)
          .catch((error) => console.error("OAuth purge failed", error)),
      );
    }
  },
} satisfies ExportedHandler<Env>;

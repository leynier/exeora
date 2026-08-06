import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import {
  ExeoraError,
  isToolName,
  needsApproval,
  policyAllows,
  TOOL_NAMES,
  type ToolName,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { api, pruneToolCalls, relayName } from "./api/index.js";
import { serveAssets } from "./assets.js";
import { type CallerIdentity, rememberMcpClient, resolveTarget, touchClient } from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { describeCall } from "./approval.js";
import { newId } from "./ids.js";
import {
  createProjectMcpHandler,
  type DispatchResult,
  handshakeClientInfo,
  peekMethod,
} from "./mcp.js";
import {
  CLI_SCOPES,
  DASHBOARD_SCOPES,
  getCliClientId,
  getDashboardClientId,
} from "./oauth/clients.js";
import { oauthRoutes } from "./oauth/routes.js";
import {
  callerAddress,
  isRateLimitedAuthPath,
  limiterFor,
  tooManyRequests,
  withinLimit,
} from "./rate-limit.js";

export { DeviceRelay } from "./relay-do.js";

/**
 * The whole of Exeora in one Worker: OAuth authorization server, MCP endpoint,
 * relay entry point, dashboard API, and the static site.
 *
 * The site was briefly a Worker of its own, on the assumption it would need a
 * framework runtime. It does not: Astro emits static HTML and the dashboard is
 * a Vite bundle. Serving both from here needs only an ASSETS binding, and it
 * removes a domain split across two Workers by path.
 */

type Props = { userId: string; clientId?: string; clientName?: string };

/** Requests carrying a valid access token. */
const authenticated = new Hono<{ Bindings: Env }>();

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

  // The request's signal, so a client that hangs up stops the work rather than
  // leaving a command running on someone's machine for its full timeout.
  const { signal } = c.req.raw;

  // Which tools to advertise. Asked only for `tools/list`, so a tool call pays
  // neither the lookup nor the round trip to the device.
  const advertised =
    (await peekMethod(c.req.raw.clone())) === "tools/list"
      ? await advertisedTools(c.env, propsOf(c.executionCtx).userId, projectId)
      : undefined;

  const handler = createProjectMcpHandler(
    projectId,
    async (context, tool, args) =>
      dispatchToDevice(c.env, {
        userId: context.userId,
        projectId,
        tool,
        args,
        caller: context.caller,
        approved: context.approved,
        canElicit: context.canElicit,
        signal,
      }),
    c.env,
    advertised,
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
 * Resolves the project, checks it belongs to the caller and that the caller's
 * client has not been revoked, and forwards the call to that project's device.
 *
 * The token is already bound to this project's resource identifier by the
 * OAuth layer, so this is the second of two independent checks rather than the
 * only one. The client check is a third: revoking deletes the OAuth grant, but
 * reading `revokedAt` in the same statement that resolves the project costs
 * nothing and closes the gap without depending on that having succeeded.
 */
async function dispatchToDevice(
  env: Env,
  call: {
    userId: string;
    projectId: string;
    tool: ToolName;
    args: unknown;
    caller: CallerIdentity;
    /** Whether the user has confirmed this exact call, on a previous round. */
    approved: boolean;
    /** Whether this client can be asked over MCP, rather than out of band. */
    canElicit: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<DispatchResult> {
  const { userId, projectId, tool, args, caller, signal } = call;

  const project = await resolveTarget(env, { userId, projectId, clientId: caller.clientId });

  // Same answer whether the project does not exist or belongs to someone else:
  // distinguishing them would make project ids enumerable.
  if (!project) {
    throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }

  if (project.clientRevokedAt) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This application's access to the project was revoked. Authorize it again to restore it.",
    );
  }

  // Checked here as well as on the machine, and both are necessary. This is
  // the only side that holds the account's policy, and an older CLI would
  // ignore a field it does not know and run the command regardless; the
  // executor's own check is what covers a local `exeora.toml` and what still
  // stands if this one is wrong.
  const verdict = policyAllows(project.policy, tool, args);
  if (!verdict.allowed) {
    const error = new ExeoraError(
      "FORBIDDEN",
      verdict.reason ?? "This project does not allow that.",
    );
    await record(env, {
      userId,
      projectId,
      tool,
      caller,
      startedAt: Date.now(),
      status: "error",
      errorCode: error.code,
    });
    throw error;
  }

  const startedAt = Date.now();
  const requestId = newId("req");
  const relay = env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId));

  // Asked before anything is dispatched, and asked here rather than in the MCP
  // layer because this is where the project's policy is known.
  if (needsApproval(project.policy, tool) && !call.approved) {
    // A client speaking 2026-07-28 is asked over MCP: the answer comes back on
    // a second round carrying a signed state bound to these arguments, which is
    // the best available answer because the person is already looking at the
    // conversation the call came from.
    if (call.canElicit) return { kind: "needs-approval" };

    // Everyone else is asked out of band. This used to refuse outright, which
    // made the setting decorative for exactly the clients most people use:
    // claude.ai and ChatGPT still speak the 2025 protocol today.
    const outcome = await relay.requestApproval({
      id: newId("apr"),
      projectId,
      tool,
      prompt: describeCall(tool, args),
      clientName: caller.clientName ?? caller.mcp?.name,
      client: callerLabel(caller),
    });

    if (outcome !== "approved") {
      const error =
        outcome === "declined"
          ? new ExeoraError("APPROVAL_DECLINED", "The call was not approved.")
          : new ExeoraError(
              "APPROVAL_TIMEOUT",
              "This project asks for every change to be confirmed, and nobody answered. " +
                "Confirm it in the terminal running `exeora connect`, or in the Exeora dashboard.",
            );

      await record(env, {
        userId,
        projectId,
        tool,
        caller,
        startedAt,
        status: "error",
        errorCode: error.code,
      });
      throw error;
    }
  }

  // Registered before the call rather than after it: awaiting `callTool` first
  // would leave the window where the client hangs up unwatched, which is
  // precisely the window a long `run_command` spends.
  const cancel = () => void relay.cancelTool(requestId).catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    const value = await relay.callTool({
      requestId,
      projectId,
      tool,
      args,
      client: callerLabel(caller),
      // Sent even though it was just enforced, because the executor narrows it
      // with the project's own `exeora.toml` before running anything.
      policy: project.policy,
    });
    await record(env, { userId, projectId, tool, caller, startedAt, status: "ok" });
    return { kind: "value", value };
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool,
      caller,
      startedAt,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
    });
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/**
 * The tools the machine serving this project can actually run.
 *
 * Undefined means "offer every tool", and it is the answer to three different
 * situations on purpose: an unresolvable project, a machine that is offline,
 * and a machine too old to have said. None of them is a reason to publish a
 * shorter list. A call that reaches an offline machine already fails with
 * `LOCAL_EXECUTOR_OFFLINE`, which is the true answer; an endpoint that
 * advertised nothing while a laptop slept would look broken instead.
 */
async function advertisedTools(
  env: Env,
  userId: string | undefined,
  projectId: string,
): Promise<ReadonlySet<ToolName> | undefined> {
  if (!userId) return undefined;

  const project = await db(env)
    .select({ deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  if (!project) return undefined;

  const capabilities = await env.DEVICE_RELAY.getByName(
    relayName(userId, project.deviceId),
  ).capabilities();

  if (!capabilities) return undefined;

  // Intersected with what this gateway knows, because the executor may be the
  // newer of the two: a tool this build has no schema for is a name and nothing
  // it could register.
  const announced = new Set<string>(capabilities.tools);
  return new Set(TOOL_NAMES.filter((name) => announced.has(name)));
}

/**
 * What the executor is told about the caller, so `exeora connect` can name it.
 *
 * Only the two display fields, never the client id: the machine's terminal is
 * a different audience from the dashboard, and an opaque identifier there is
 * noise rather than information.
 */
function callerLabel(caller: CallerIdentity): { name?: string; version?: string } | undefined {
  const name = caller.clientName ?? caller.mcp?.name;
  const version = caller.mcp?.version;
  if (!name && !version) return undefined;
  return { ...(name ? { name } : {}), ...(version ? { version } : {}) };
}

/** Audit row. Records what ran and how it ended, never arguments or output. */
async function record(
  env: Env,
  entry: {
    userId: string;
    projectId: string;
    tool: string;
    caller: CallerIdentity;
    startedAt: number;
    status: "ok" | "error";
    errorCode?: string;
  },
): Promise<void> {
  const { caller } = entry;

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
        clientId: caller.clientId ?? null,
        clientName: caller.clientName ?? caller.mcp?.name ?? null,
      })
      .run();

    if (caller.clientId) {
      await touchClient(
        env,
        { userId: entry.userId, projectId: entry.projectId, clientId: caller.clientId },
        caller.mcp,
      );
    }
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

/** Everything else: the OAuth screens, then the static site. */
const site = new Hono<{ Bindings: Env }>();
site.route("/", oauthRoutes);

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

export { isToolName };

const provider = new OAuthProvider({
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
   * Nightly housekeeping. Neither half belongs to a request: the audit log is
   * written by tool calls that have long since answered, and expired grants are
   * only noticed by whoever tries to use one.
   *
   * The two are independent, so a failure in one must not skip the other.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pruneToolCalls(env));
    ctx.waitUntil(provider.purgeExpiredData(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

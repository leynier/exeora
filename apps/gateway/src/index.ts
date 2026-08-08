import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import {
  type AccountToolName,
  ExeoraError,
  isToolName,
  needsApproval,
  policyAllows,
  TOOL_NAMES,
  type ToolName,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { api, relayName, runNightlyHousekeeping } from "./api/index.js";
import { internal } from "./api/internal.js";
import { serveAssets } from "./assets.js";
import {
  type AccountProject,
  accountProjects,
  activeProjectChoice,
  type CallerIdentity,
  rememberAccountMcpClient,
  rememberMcpClient,
  resolveAccountTarget,
  resolveTarget,
  setActiveProjectId,
  touchAccountClient,
  touchClient,
} from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { describeCall } from "./approval.js";
import { type AuditWriteMode, auditEvent, auditWriteMode, writeAuditEvent } from "./audit.js";
import { observeD1 } from "./cost-metrics.js";
import { newId } from "./ids.js";
import {
  createProjectMcpHandler,
  type DispatchResult,
  handshakeClientInfo,
  peekMethod,
} from "./mcp.js";
import {
  ACCOUNT_MCP_ROUTE,
  type AccountCall,
  type AccountDispatchResult,
  createAccountMcpHandler,
} from "./mcp-account.js";
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
import { callRelayTool, requestRelayApproval } from "./relay-client.js";

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
 * The account endpoint: one URL for every project a client was given.
 *
 * Which project a call lands in is state rather than path, so it is resolved
 * per call: the `project` argument if the call named one, then the client's
 * active project, then the only project it can reach if there is only one.
 */
authenticated.all(ACCOUNT_MCP_ROUTE, async (c) => {
  const { signal } = c.req.raw;
  const { userId, clientId } = propsOf(c.executionCtx);

  const advertised =
    (await peekMethod(c.req.raw.clone())) === "tools/list"
      ? await advertisedAccountTools(c.env, userId, clientId)
      : undefined;

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

/**
 * Where a call on the account endpoint runs.
 *
 * The order is the call's own `project`, then the client's choice, then the one
 * project it can reach if it never made one. That last step is a convenience
 * with a hard limit: it applies only to a connection that has never chosen. A
 * connection whose choice has since been revoked is refused instead, because the
 * agent still believes it is where it chose and nothing on a stateless endpoint
 * has told it otherwise.
 *
 * A client that reaches exactly one project and never chose is not ambiguous,
 * so making it say so first would be ceremony. With two, guessing would be
 * picking a repository on someone's behalf, and the honest answer is to name
 * the tools that settle it.
 *
 * Resolved rather than persisted when it falls through to the only project: the
 * pointer would say something the access list already says, and it would go
 * stale the moment a second project is granted.
 *
 * Exported for its tests. This decides which repository a call lands in, so the
 * order above is worth pinning down somewhere that fails when it changes.
 */
export async function resolveAccountProject(
  // Only the binding it reads, for the same reason `limiterFor` narrows its
  // own: `OAUTH_PROVIDER` is injected by the provider on the way into a
  // handler, so asking for the whole Env would make this uncallable from a test.
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string; named: string | undefined },
): Promise<AccountProject> {
  // Asked together, because neither answer depends on the other and this pair
  // sits in front of every tool call the endpoint serves. A call that names its
  // own project skips the second question entirely: nothing below reads it.
  const [reachable, choice] =
    entry.named !== undefined
      ? [await accountProjects(env, entry), null]
      : await Promise.all([accountProjects(env, entry), activeProjectChoice(env, entry)]);

  if (entry.named !== undefined) {
    const named = reachable.find(
      (project) => project.slug === entry.named || project.id === entry.named,
    );
    // Same answer for a project that does not exist, is someone else's, or was
    // never granted to this client: telling them apart would make ids and slugs
    // enumerable from a connection that cannot reach them.
    if (!named) {
      throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available on this connection.");
    }
    return named;
  }

  if (choice?.reachable) {
    const chosen = reachable.find((project) => project.id === choice.projectId);
    if (chosen) return chosen;
  }

  // Authorizing again is named first because it is the one answer that always
  // works. A connection with no rows at all is not listed under Clients and
  // cannot be given a project from there: that happens when the authorization
  // never named `/mcp` as its resource, so no projects were ever ticked, and
  // when every project it had has since been deleted. Sending someone to a
  // screen that cannot show them the client would be a dead end.
  if (reachable.length === 0) {
    throw new ExeoraError(
      "NO_ACTIVE_PROJECT",
      "This connection has not been given access to any project. Authorize it again from the " +
        "client and tick the projects it may reach, or give it one under Clients in the Exeora " +
        "dashboard if it is listed there.",
    );
  }

  // A choice that no longer stands is refused rather than replaced, even when
  // only one project is left to replace it with. The agent still believes it is
  // in the project it chose, and nothing on a stateless endpoint has told it
  // otherwise, so quietly resolving somewhere else is how a `write_file` meant
  // for one repository lands in another. Saying so is the only answer that
  // cannot be wrong.
  if (choice) {
    throw new ExeoraError(
      "NO_ACTIVE_PROJECT",
      "The project you were working in is no longer available on this connection. " +
        "Call list_projects to see what is, then set_active_project to choose one.",
    );
  }

  // Never chose, and there is only one thing it could have meant.
  if (reachable.length === 1 && reachable[0]) return reachable[0];

  throw new ExeoraError(
    "NO_ACTIVE_PROJECT",
    "No project is selected. Call list_projects to see what is available, then set_active_project to choose one.",
  );
}

/** Resolves the project, then hands the call to the same dispatcher as always. */
async function dispatchAccountCall(
  env: Env,
  call: AccountCall,
  tool: ToolName,
  args: unknown,
  signal: AbortSignal | undefined,
): Promise<AccountDispatchResult> {
  const { userId, caller } = call;
  const clientId = caller.clientId;

  // Every account token is minted through a consent screen that records the
  // client, so there is always one. A call without it has no access list and
  // therefore no access.
  if (!clientId) {
    throw new ExeoraError("FORBIDDEN", "This connection cannot be identified.");
  }

  const project = await resolveAccountProject(env, { userId, clientId, named: call.project });

  const result = await dispatchToDevice(env, {
    userId,
    projectId: project.id,
    tool,
    args,
    caller,
    // An approval names the project it was given for, and is worth nothing
    // anywhere else. Without this comparison, confirming `run_command` in one
    // project would confirm the same command in every other.
    approved: call.approvedProjectId === project.id,
    canElicit: call.canElicit,
    signal,
    endpoint: "account",
  });

  return result.kind === "needs-approval"
    ? { kind: "needs-approval", projectId: project.id, project: project.slug }
    : result;
}

/** The three tools that never leave the gateway. */
async function answerAccountTool(
  env: Env,
  call: Pick<AccountCall, "userId" | "caller">,
  tool: AccountToolName,
  args: unknown,
): Promise<unknown> {
  const { userId, caller } = call;
  const clientId = caller.clientId;

  if (!clientId) {
    throw new ExeoraError("FORBIDDEN", "This connection cannot be identified.");
  }

  const entry = { userId, clientId };

  // Bookkeeping only, and never a reason for the call to fail.
  const touch = () => touchAccountClient(env, entry, caller.mcp).catch(() => undefined);

  if (tool === "set_active_project") {
    const named = (args as { project?: unknown } | null)?.project;

    // Refused rather than inferred. The schema makes the argument required, so
    // reaching here without it means a client that did not validate; falling
    // through to `resolveAccountProject` would answer "switched" for a call
    // that named nothing, or refuse with `NO_ACTIVE_PROJECT` from the one tool
    // whose job is to get out of that state.
    if (typeof named !== "string" || named.length === 0) {
      throw new ExeoraError("INVALID_ARGUMENTS", "Name the project to switch to, by slug or id.");
    }

    const project = await resolveAccountProject(env, { ...entry, named });

    await setActiveProjectId(env, { ...entry, projectId: project.id });
    await record(env, {
      userId,
      projectId: project.id,
      tool,
      caller,
      startedAt: Date.now(),
      status: "ok",
      endpoint: "account",
    });

    return { project: { ...summarise(project), active: true } };
  }

  const [reachable, choice] = await Promise.all([
    accountProjects(env, entry),
    activeProjectChoice(env, entry),
  ]);

  // The same rule the dispatcher applies, so what these two report is where the
  // next call would actually go rather than a second opinion about it. A choice
  // that no longer stands reports nothing, because the next call refuses: saying
  // "the only project" there would promise a redirect that will not happen.
  const effective = choice
    ? choice.reachable
      ? choice.projectId
      : null
    : ((reachable.length === 1 ? reachable[0]?.id : undefined) ?? null);

  await touch();

  if (tool === "get_active_project") {
    const chosen = reachable.find((project) => project.id === effective);
    return { project: chosen ? { ...summarise(chosen), active: true } : null };
  }

  return {
    projects: reachable.map((project) => ({
      ...summarise(project),
      active: project.id === effective,
    })),
    activeProject: reachable.find((project) => project.id === effective)?.slug ?? null,
  };
}

/** A project as an agent sees it. Never its id, and never its path on disk. */
function summarise(project: AccountProject) {
  return {
    slug: project.slug,
    name: project.name,
    machine: project.machine,
    online: project.online,
  };
}

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
    /**
     * Which URL the call arrived on. Only the audit trail and the client's
     * bookkeeping care: by this point the project is resolved and everything
     * below runs the same either way.
     */
    endpoint?: "project" | "account";
  },
): Promise<DispatchResult> {
  const { userId, projectId, tool, args, caller, signal, endpoint = "project" } = call;

  // On the account endpoint the caller has already been checked against the
  // access list, which is the only thing that grants a project there; this
  // resolves the device and the policy for it.
  //
  // A call that arrived there without a client id resolves to nothing rather
  // than falling back to `resolveTarget`, which lets an unknown client through
  // by design. That default is right for a token bound to one project's URL and
  // wrong here, where the client is the whole access list: falling back would
  // turn "we cannot tell who this is" into "reach any project on the account".
  const project =
    endpoint === "account"
      ? caller.clientId
        ? await resolveAccountTarget(env, { userId, projectId, clientId: caller.clientId })
        : null
      : await resolveTarget(env, { userId, projectId, clientId: caller.clientId });

  // Same answer whether the project does not exist or belongs to someone else:
  // distinguishing them would make project ids enumerable.
  if (!project) {
    throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }

  if ("clientRevokedAt" in project && project.clientRevokedAt) {
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
      endpoint,
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
    if (call.canElicit) return { kind: "needs-approval", projectId };

    // Everyone else is asked out of band. This used to refuse outright, which
    // made the setting decorative for exactly the clients most people use:
    // claude.ai and ChatGPT still speak the 2025 protocol today.
    const outcome = await requestRelayApproval(relay, {
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
        endpoint,
      });
      throw error;
    }
  }

  try {
    const value = await callRelayTool(relay, {
      requestId,
      projectId,
      tool,
      args,
      client: callerLabel(caller),
      // Sent even though it was just enforced, because the executor narrows it
      // with the project's own `exeora.toml` before running anything.
      policy: project.policy,
      signal,
    });
    await record(env, { userId, projectId, tool, caller, startedAt, status: "ok", endpoint });
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
      endpoint,
    });
    throw error;
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
 * The same question on the account endpoint, asked of whichever project the
 * connection is currently pointed at.
 *
 * Undefined, meaning "offer every tool", whenever there is nothing to narrow
 * by: no project selected, or several to choose from and none chosen. That is
 * the right answer rather than an empty list, because the three management
 * tools are always registered and a connection whose whole purpose is to be
 * pointed somewhere should not look empty before it has been.
 *
 * Switching the active project can change this answer, and nothing tells the
 * client so: the endpoint is stateless and there is no session to notify. A
 * client that never lists again keeps offering a tool the current project's
 * machine cannot run, and that call fails with `LOCAL_EXECUTOR_OFFLINE` or
 * `UNKNOWN_TOOL`, which is the same thing it would have said anyway.
 */
async function advertisedAccountTools(
  env: Env,
  userId: string | undefined,
  clientId: string | undefined,
): Promise<ReadonlySet<ToolName> | undefined> {
  if (!userId || !clientId) return undefined;

  const [reachable, choice] = await Promise.all([
    accountProjects(env, { userId, clientId }),
    activeProjectChoice(env, { userId, clientId }),
  ]);

  // The dispatcher's rule, not a second reading of it: the fallback to the only
  // project belongs to a connection that never chose. A choice that no longer
  // stands is refused there rather than replaced, so narrowing by whatever is
  // left would publish a toolset for a project no call will reach.
  const chosen = choice
    ? choice.reachable
      ? reachable.find((project) => project.id === choice.projectId)
      : undefined
    : reachable.length === 1
      ? reachable[0]
      : undefined;

  return chosen ? advertisedTools(env, userId, chosen.id) : undefined;
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
    endpoint?: "project" | "account";
  },
): Promise<void> {
  const { caller } = entry;
  const id = newId("call");
  const durationMs = Date.now() - entry.startedAt;
  const writes: Promise<unknown>[] = [];

  // Resolving the mode is itself fallible: a `dual`/`pipeline` deployment with
  // no stream bound throws here on purpose, and a configuration mistake must
  // still not be the reason a tool call fails or the reason its real error is
  // replaced by this one. Loud in the logs, invisible to the caller.
  let mode: AuditWriteMode | null = null;
  try {
    mode = auditWriteMode(env);
  } catch (error) {
    console.error("audit write mode is misconfigured; no audit row was written", error);
  }

  if (mode && mode !== "pipeline") {
    writes.push(
      db(env)
        .insert(schema.toolCalls)
        .values({
          id,
          userId: entry.userId,
          projectId: entry.projectId,
          tool: entry.tool,
          status: entry.status,
          durationMs,
          errorCode: entry.errorCode ?? null,
          clientId: caller.clientId ?? null,
          clientName: caller.clientName ?? caller.mcp?.name ?? null,
        })
        .run()
        .then((result) => observeD1(id, "audit.insert", result.meta)),
    );
  }

  if (mode && mode !== "d1")
    writes.push(writeAuditEvent(env, auditEvent(id, { ...entry, durationMs })));

  if (caller.clientId) {
    writes.push(
      touchClient(
        env,
        {
          userId: entry.userId,
          projectId: entry.projectId,
          clientId: caller.clientId,
          endpoint: entry.endpoint ?? "project",
        },
        caller.mcp,
      ),
    );
  }

  // Auditing and last-used bookkeeping must never be why a tool call fails, but
  // a failure that leaves no trace is worse than the failure: in `pipeline` mode
  // a rejected stream write is the whole audit row, and the sampled cost metric
  // only sees one event in a thousand. Loud in the logs, invisible to the caller.
  for (const result of await Promise.allSettled(writes)) {
    if (result.status === "rejected") {
      console.error("audit or last-used bookkeeping failed", result.reason);
    }
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

export { isToolName };

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
   * Nightly housekeeping. None of this belongs to a request: the audit log is
   * written by tool calls that have long since answered, the usage rollup is
   * derived from it before the prune, and expired grants are only noticed by
   * whoever tries to use one.
   *
   * Rollup prefers to run first so it still sees rows the prune is about to
   * drop, but a failure there must not skip the prune: retention is the job
   * that bounds an unbounded table. The OAuth purge is independent of both.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runNightlyHousekeeping(env));
    ctx.waitUntil(provider.purgeExpiredData(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

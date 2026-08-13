import { type AccountToolName, ExeoraError, type ToolName } from "@exeora/protocol";
import { beginAudit } from "./audit.js";
import {
  type AccountProject,
  accountProjects,
  activeProjectChoice,
  setActiveProjectId,
} from "./client-targets.js";
import { touchAccountClient } from "./clients.js";
import { dispatchToDevice, record } from "./dispatch.js";
import "./env.js";
import type { AccountCall, AccountDispatchResult } from "./mcp-account.js";

/**
 * The account endpoint's own half of a call: which project it lands in, and the
 * three tools that answer without leaving the gateway.
 *
 * A per-project URL carries its project in the path and needs none of this. Here
 * the project is state rather than path, so it is resolved per call, and the
 * tools that read and move that state have nowhere else to live.
 */

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
export async function dispatchAccountCall(
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
export async function answerAccountTool(
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
    const audit = await beginAudit(env, {
      userId,
      projectId: project.id,
      tool,
      caller,
      endpoint: "account",
    }).catch((error) => {
      console.error("audit outbox begin failed", error);
      throw new ExeoraError(
        "INTERNAL_ERROR",
        "The audit service is unavailable, so the project was not changed. Try again later.",
      );
    });

    await setActiveProjectId(env, { ...entry, projectId: project.id });
    await record(env, {
      userId,
      projectId: project.id,
      tool,
      caller,
      audit,
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

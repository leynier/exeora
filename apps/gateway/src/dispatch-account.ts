import { type AccountToolName, ExeoraError, type ToolName } from "@exeora/protocol";
import { type AccountProject, accountProjects } from "./client-targets.js";
import { touchAccountClient } from "./clients.js";
import { dispatchToDevice } from "./dispatch.js";
import "./env.js";
import type { AccountCall, AccountDispatchResult } from "./mcp-account.js";

/**
 * The account endpoint's own half of a call: which project it lands in, and the
 * tool that answers without leaving the gateway.
 *
 * A per-project URL carries its project in the path and needs none of this. Here
 * the project is named per call when there is more than one choice, and the
 * tool that lists those choices has nowhere else to live.
 */

/**
 * Where a call on the account endpoint runs.
 *
 * A project named by the call wins. With no name, exactly one reachable project
 * is unambiguous and resolves automatically. With two or more, guessing would
 * be picking a repository on someone's behalf, so the call is invalid until it
 * names one. Nothing is persisted: two conversations in the same client can
 * therefore work in different projects without moving each other.
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
  const reachable = await accountProjects(env, entry);

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

  if (reachable.length === 0) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This connection has not been given access to any project. Authorize it again from the " +
        "client and tick the projects it may reach, or give it one under Clients in the Exeora " +
        "dashboard if it is listed there.",
    );
  }

  if (reachable.length === 1 && reachable[0]) return reachable[0];

  throw new ExeoraError(
    "INVALID_ARGUMENTS",
    "This connection reaches several projects. Call list_projects, then pass a project slug or id on every tool call.",
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

/** The account tool that never leaves the gateway. */
export async function answerAccountTool(
  env: Env,
  call: Pick<AccountCall, "userId" | "caller">,
  _tool: AccountToolName,
  _args: unknown,
): Promise<unknown> {
  const { userId, caller } = call;
  const clientId = caller.clientId;

  if (!clientId) {
    throw new ExeoraError("FORBIDDEN", "This connection cannot be identified.");
  }

  const entry = { userId, clientId };

  // Bookkeeping only, and never a reason for the call to fail.
  const touch = () => touchAccountClient(env, entry, caller.mcp).catch(() => undefined);

  const reachable = await accountProjects(env, entry);
  await touch();
  return { projects: reachable.map(summarise) };
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

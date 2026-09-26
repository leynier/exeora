import {
  CLOUD_MAIN_WORKSPACE_SLUG,
  CLOUD_WORKSPACE_ROOT,
  CreateWorkspaceInput,
  ExeoraError,
  RELAY_TIMEOUT_MS,
  RemoveWorkspaceInput,
  type ToolName,
  type WorkspaceUnpublished,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { relayName } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { callRelayWorkspace } from "../relay-client.js";
import type { CloudEnv } from "./access.js";
import {
  cloudProjectOf,
  createCloudWorkspace,
  destroyCloudWorkspace,
  type ProvisionError,
} from "./provisioning.js";

/**
 * The workspace lifecycle tools, answered here for a cloud project.
 *
 * On a laptop these tools are git worktrees the CLI makes and removes. On a
 * cloud project a workspace is a machine, so they are answered by the gateway,
 * which is the only party that can create one. Policy, approval and the audit
 * row have already happened by the time a call gets here: this sits exactly
 * where the relay call would, and returns undefined for any project that is
 * not a cloud project so the relay call happens instead.
 */

/** The time a call waits for a new machine before handing the wait back to the agent. */
const CREATE_BUDGET_MS = RELAY_TIMEOUT_MS - 20_000;
const POLL_MS = 2_000;

export interface CloudToolCall {
  userId: string;
  projectId: string;
  tool: ToolName;
  args: unknown;
  workspace: { id: string; slug: string } | null;
  signal?: AbortSignal | undefined;
  issuedAt: number;
  /**
   * Puts the call to the machine whose checkout it concerns, which answers
   * with its own `exeora.toml` applied: a verdict, or the refusal to throw.
   * The account's policy was checked before this; the checkout's is checked
   * by the one party that can read it, before anything is made or destroyed.
   */
  askMachine?: (() => Promise<unknown>) | undefined;
}

export async function isCloudProject(env: Pick<Env, "DB">, projectId: string): Promise<boolean> {
  const row = await db(env)
    .select({ projectId: schema.cloudProjects.projectId })
    .from(schema.cloudProjects)
    .where(eq(schema.cloudProjects.projectId, projectId))
    .get();
  return row !== undefined;
}

export async function answerCloudWorkspaceTool(
  env: CloudEnv,
  call: CloudToolCall,
): Promise<unknown | undefined> {
  const project = await cloudProjectOf(env, call.userId, call.projectId);
  if (!project) return undefined;

  switch (call.tool) {
    case "list_git_workspaces":
      return listGitWorkspaces(env, call.projectId, project.defaultBranch);
    case "create_workspace":
      return createWorkspace(env, call);
    case "remove_workspace":
      return removeWorkspace(env, call);
    case "attach_workspace":
    case "detach_workspace":
      throw new ExeoraError(
        "FORBIDDEN",
        "Cloud projects manage their own workspaces. Use create_workspace and remove_workspace.",
      );
    default:
      return undefined;
  }
}

/**
 * The inventory of a project's workspaces for `list_workspaces`, with the
 * machine state of any that live on a cloud machine.
 */
export async function listWorkspacesWithCloud(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
) {
  const rows = await db(env)
    .select({
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      branch: schema.workspaces.branch,
      managed: schema.workspaces.managed,
      status: schema.cloudMachines.status,
      error: schema.cloudMachines.error,
    })
    .from(schema.workspaces)
    .innerJoin(schema.projects, eq(schema.workspaces.projectId, schema.projects.id))
    .leftJoin(schema.cloudMachines, eq(schema.cloudMachines.workspaceId, schema.workspaces.id))
    .where(and(eq(schema.workspaces.projectId, projectId), eq(schema.projects.userId, userId)))
    .all();
  return rows.map(({ status, error, ...workspace }) => ({
    ...workspace,
    ...(status ? { cloud: { status, error } } : {}),
  }));
}

async function listGitWorkspaces(env: Pick<Env, "DB">, projectId: string, defaultBranch: string) {
  const rows = await db(env)
    .select({
      slug: schema.workspaces.slug,
      branch: schema.workspaces.branch,
      status: schema.cloudMachines.status,
    })
    .from(schema.workspaces)
    .leftJoin(schema.cloudMachines, eq(schema.cloudMachines.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaces.projectId, projectId))
    .all();
  return {
    workspaces: [
      {
        path: CLOUD_WORKSPACE_ROOT,
        branch: defaultBranch,
        primary: true,
        connected: true,
        connectedSlug: CLOUD_MAIN_WORKSPACE_SLUG,
      },
      ...rows.map((row) => ({
        path: CLOUD_WORKSPACE_ROOT,
        branch: row.branch,
        primary: false,
        connected: row.status === "ready",
        connectedSlug: row.slug,
      })),
    ],
  };
}

async function createWorkspace(env: CloudEnv, call: CloudToolCall) {
  const input = CreateWorkspaceInput.safeParse(call.args ?? {});
  if (!input.success) {
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      input.error.issues[0]?.message ?? "Invalid arguments.",
    );
  }
  if (input.data.reuseExistingBranch) {
    // A new machine clones the remote, so a branch exists there or not; there
    // is no local branch to reuse. Accepted as a no-op rather than refused.
  }
  await call.askMachine?.();
  const created = await createCloudWorkspace(env, call.userId, call.projectId, {
    branch: input.data.branch,
    from: input.data.from,
    name: input.data.name,
    slug: input.data.slug,
  });
  if ("error" in created) throw toolError(created);

  const deadline = call.issuedAt + CREATE_BUDGET_MS;
  for (;;) {
    const machine = await db(env)
      .select({ status: schema.cloudMachines.status, error: schema.cloudMachines.error })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, created.deviceId))
      .get();
    if (machine?.status === "ready") {
      return {
        workspace: {
          id: created.workspaceId,
          slug: created.slug,
          name: input.data.name ?? input.data.branch,
          branch: input.data.branch,
          managed: true,
        },
        outcome: "active",
      };
    }
    if (!machine || machine.status === "error" || machine.status === "destroying") {
      throw new ExeoraError(
        "TOOL_FAILED",
        `The workspace's machine could not be created: ${machine?.error ?? "it was removed"}`,
      );
    }
    if (call.signal?.aborted) throw new ExeoraError("CANCELLED", "The call was cancelled.");
    if (Date.now() + POLL_MS > deadline) {
      throw new ExeoraError(
        "TOOL_TIMEOUT",
        `The workspace ${created.slug} is still being created. Call list_workspaces to see when it is ready.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function removeWorkspace(env: CloudEnv, call: CloudToolCall) {
  if (!call.workspace) {
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      "Name the workspace to remove. The main workspace is the project itself and cannot be removed.",
    );
  }
  const input = RemoveWorkspaceInput.safeParse(call.args ?? {});
  if (!input.success) {
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      input.error.issues[0]?.message ?? "Invalid arguments.",
    );
  }
  const row = await db(env)
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      branch: schema.workspaces.branch,
      deviceId: schema.workspaces.deviceId,
    })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, call.workspace.id),
        eq(schema.workspaces.projectId, call.projectId),
      ),
    )
    .get();
  if (!row?.deviceId)
    throw new ExeoraError("UNKNOWN_WORKSPACE", "That workspace is not available.");
  // The machine's own policy is asked first. A machine that cannot answer is
  // not a refusal: with `force`, the removal is what recovers it; without,
  // its answer is required like its status is.
  try {
    await call.askMachine?.();
  } catch (error) {
    // A refusal stands, and so does a cancellation: neither is the machine
    // being out of reach, which is the one thing force is for.
    if (
      error instanceof ExeoraError &&
      (error.code === "FORBIDDEN" || error.code === "CANCELLED")
    ) {
      throw error;
    }
    if (!input.data.force) {
      throw new ExeoraError(
        "TOOL_FAILED",
        `Could not ask the workspace's machine (${error instanceof Error ? error.message : String(error)}). Pass force to remove it anyway.`,
      );
    }
  }

  // The machine is the only copy of whatever the remote does not have.
  // Unless forced, it is asked what that is, with the remote in view, and
  // refused when there is anything or when it cannot be asked at all.
  if (!input.data.force) {
    let answer: WorkspaceUnpublished;
    try {
      const value = await callRelayWorkspace(
        env.DEVICE_RELAY.getByName(relayName(call.userId, row.deviceId)),
        {
          requestId: newId("req"),
          projectId: call.projectId,
          workspaceId: row.id,
          workspaceSlug: row.slug,
          action: { action: "unpublished" },
          signal: call.signal,
        },
      );
      if (value.kind !== "unpublished") throw new Error("unexpected answer");
      answer = value;
    } catch (error) {
      throw new ExeoraError(
        "TOOL_FAILED",
        `Could not check the workspace for unpublished work (${error instanceof Error ? error.message : String(error)}). Pass force to remove it anyway.`,
      );
    }
    if (!answer.clean) {
      throw new ExeoraError(
        "TOOL_FAILED",
        `The workspace holds work the remote does not have (${answer.reasons.join("; ")}), and its machine is the only copy. Push it, or pass force to discard it.`,
      );
    }
  }

  // The last moment a cancellation can still mean anything.
  if (call.signal?.aborted) throw new ExeoraError("CANCELLED", "The call was cancelled.");
  await destroyCloudWorkspace(env, call.userId, call.projectId, row.id);
  return {
    workspace: { id: row.id, slug: row.slug, name: row.name, branch: row.branch, managed: true },
    outcome: "removed",
    branchDeleted: false,
  };
}

function toolError(error: ProvisionError): ExeoraError {
  switch (error.error) {
    case "cloud_disabled":
      return new ExeoraError("FORBIDDEN", "Exeora Cloud is not enabled for this account.");
    case "cli_unsupported":
      return new ExeoraError("TOOL_FAILED", error.message);
    case "plan_limit":
      return new ExeoraError(
        "FORBIDDEN",
        `This account may have ${error.max ?? "no more"} cloud machines on the ${error.plan} plan. Remove one first.`,
      );
    case "slug_conflict":
      return new ExeoraError("INVALID_ARGUMENTS", "A workspace with that slug already exists.");
    case "invalid_branch":
    case "invalid_repo_url":
      return new ExeoraError("INVALID_ARGUMENTS", error.message);
    case "credentials_unavailable":
      return new ExeoraError("TOOL_FAILED", "This gateway cannot read the repository credential.");
    case "not_retryable":
    case "not_found":
      return new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }
}

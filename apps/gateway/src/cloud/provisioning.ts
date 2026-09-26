import {
  CLOUD_MAIN_WORKSPACE_SLUG,
  CLOUD_WORKSPACE_ROOT,
  cliSupportsCloud,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { planOf } from "../api/plan.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { limitsFor, type PlanId } from "../plans.js";
import { type CloudEnv, cloudAccess, spriteNameFor } from "./access.js";
import { decryptSecret, encryptSecret } from "./credentials.js";
import type { MachineSeed } from "./machine-do.js";
import { cliUnsupported, insertCloudDevice, startMachine } from "./machine-start.js";
import { machineTokenHash, mintMachineToken } from "./machine-tokens.js";
import { slugFromBranch, validBranch } from "./naming.js";

/**
 * The mutations behind Exeora Cloud, shared by the dashboard API and the
 * workspace tools an agent calls over MCP.
 *
 * Creating a machine is two things in order: rows in D1 that reserve the
 * plan's slot and give everyone something to look at, then a `CloudMachine`
 * object that turns the rows into a Sprite. The rows come first so a second
 * request cannot pass the same cap, and they carry `creating` until the
 * object reports otherwise.
 */

export type ProvisionError =
  | { error: "cloud_disabled" }
  | { error: "invalid_repo_url"; message: string }
  | { error: "cli_unsupported"; message: string }
  | { error: "plan_limit"; limit: "cloudMachines" | "projects"; max: number | null; plan: PlanId }
  | { error: "slug_conflict" }
  | { error: "credentials_unavailable" }
  | { error: "invalid_branch"; message: string }
  | { error: "not_retryable" }
  | { error: "not_found" };

export interface Credential {
  username: string;
  secret: string;
}

export async function createCloudProject(
  env: CloudEnv,
  userId: string,
  input: {
    name: string;
    slug: string;
    repoUrl: string;
    defaultBranch: string;
    credential?: Credential | undefined;
  },
): Promise<{ projectId: string; deviceId: string } | ProvisionError> {
  // Checked here and not only at the routes: the workspace tools reach this
  // over MCP, and an account switched off must stop making machines there too.
  if (!(await cloudAccess(env, userId))) return { error: "cloud_disabled" };
  if (!cliSupportsCloud(env.LATEST_CLI_VERSION)) return cliUnsupported(env);
  if (!validRepoUrl(input.repoUrl)) {
    return {
      error: "invalid_repo_url",
      message:
        "Use a plain https:// URL. A token goes in the token field, where it is stored encrypted, not in the address.",
    };
  }
  if (!validBranch(input.defaultBranch)) {
    return { error: "invalid_branch", message: "That is not a valid branch name." };
  }
  const plan = await planOf(env, userId);
  const limits = limitsFor(plan);

  const taken = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.slug, input.slug)))
    .get();
  if (taken) return { error: "slug_conflict" };

  let ciphertext: string | null = null;
  if (input.credential) {
    if (!env.CLOUD_CREDENTIALS_KEY) return { error: "credentials_unavailable" };
    ciphertext = await encryptSecret(env.CLOUD_CREDENTIALS_KEY, input.credential.secret);
  }

  const deviceId = newId("dev");
  const projectId = newId("prj");
  const spriteName = spriteNameFor(env, deviceId);
  const token = mintMachineToken(deviceId);
  const tokenHash = await machineTokenHash(token);

  // One batch, and each row is selected out of the one before it, so a cap
  // that refuses the machine leaves nothing behind it. The project cap is the
  // exception, checked in the same way as `POST /api/projects` does.
  const results = await env.DB.batch([
    insertCloudDevice(
      env,
      userId,
      deviceId,
      `${input.slug} (${CLOUD_MAIN_WORKSPACE_SLUG})`,
      limits.maxCloudMachines,
    ),
    env.DB.prepare(
      `INSERT INTO projects (id, user_id, device_id, name, slug, local_path)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM devices
        WHERE id = ?3
          AND (?7 IS NULL OR (SELECT COUNT(*) FROM projects WHERE user_id = ?2) < ?7)`,
    ).bind(
      projectId,
      userId,
      deviceId,
      input.name,
      input.slug,
      CLOUD_WORKSPACE_ROOT,
      limits.maxProjects,
    ),
    env.DB.prepare(
      `INSERT INTO cloud_projects (project_id, user_id, repo_url, default_branch, credential_username, credential_ciphertext)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM projects WHERE id = ?1`,
    ).bind(
      projectId,
      userId,
      input.repoUrl,
      input.defaultBranch,
      input.credential?.username ?? null,
      ciphertext,
    ),
    env.DB.prepare(
      `INSERT INTO cloud_machines (device_id, user_id, project_id, workspace_id, sprite_name, token_hash, status, step)
       SELECT ?1, ?2, ?3, NULL, ?4, ?5, 'creating', 'Creating machine' FROM projects WHERE id = ?3`,
    ).bind(deviceId, userId, projectId, spriteName, tokenHash),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    return { error: "plan_limit", limit: "cloudMachines", max: limits.maxCloudMachines, plan };
  }
  if ((results[1]?.meta.changes ?? 0) === 0) {
    await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(deviceId).run();
    return { error: "plan_limit", limit: "projects", max: limits.maxProjects, plan };
  }

  await startMachine(env, {
    seed: { userId, deviceId, projectId, workspaceId: null, spriteName },
    project: { id: projectId, slug: input.slug, name: input.name },
    workspace: {
      id: `wsp_${deviceId.slice(4)}`,
      slug: CLOUD_MAIN_WORKSPACE_SLUG,
      branch: input.defaultBranch,
    },
    repoUrl: input.repoUrl,
    branch: input.defaultBranch,
    machineToken: token,
    credential: input.credential,
  });
  return { projectId, deviceId };
}

export async function createCloudWorkspace(
  env: CloudEnv,
  userId: string,
  projectId: string,
  input: {
    branch: string;
    from?: string | undefined;
    name?: string | undefined;
    slug?: string | undefined;
  },
): Promise<{ workspaceId: string; deviceId: string; slug: string } | ProvisionError> {
  if (!(await cloudAccess(env, userId))) return { error: "cloud_disabled" };
  if (!cliSupportsCloud(env.LATEST_CLI_VERSION)) return cliUnsupported(env);
  const project = await cloudProjectOf(env, userId, projectId);
  if (!project || project.deletingAt) return { error: "not_found" };
  if (!validBranch(input.branch) || (input.from !== undefined && !validBranch(input.from))) {
    return { error: "invalid_branch", message: "That is not a valid branch name." };
  }
  if (input.branch === project.defaultBranch) {
    return {
      error: "invalid_branch",
      message: `${project.defaultBranch} is the project's default branch and is already served by its main workspace.`,
    };
  }

  const plan = await planOf(env, userId);
  const limits = limitsFor(plan);
  const slug = input.slug ?? slugFromBranch(input.branch);
  const taken = await db(env)
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.projectId, projectId), eq(schema.workspaces.slug, slug)))
    .get();
  if (taken) return { error: "slug_conflict" };

  const credential = await credentialOf(env, project);
  if (credential === "unavailable") return { error: "credentials_unavailable" };
  // The project's default branch, not the remote's HEAD: they differ on a
  // repository whose work happens on `develop`.
  const createBranchFrom = input.from ?? project.defaultBranch;

  const deviceId = newId("dev");
  const workspaceId = newId("wsp");
  const spriteName = spriteNameFor(env, deviceId);
  const token = mintMachineToken(deviceId);
  const tokenHash = await machineTokenHash(token);

  const results = await env.DB.batch([
    insertCloudDevice(env, userId, deviceId, `${project.slug} (${slug})`, limits.maxCloudMachines),
    // Selected out of the project's cloud row as well: a removal accepted
    // meanwhile has marked it, and a workspace made past that mark would be a
    // machine the removal never enumerated.
    env.DB.prepare(
      `INSERT INTO workspaces (id, project_id, slug, name, branch, local_path, managed, device_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 1, ?7 FROM devices
        WHERE id = ?7
          AND EXISTS (SELECT 1 FROM cloud_projects WHERE project_id = ?2 AND deleting_at IS NULL)`,
    ).bind(
      workspaceId,
      projectId,
      slug,
      input.name ?? input.branch,
      input.branch,
      CLOUD_WORKSPACE_ROOT,
      deviceId,
    ),
    env.DB.prepare(
      `INSERT INTO cloud_machines (device_id, user_id, project_id, workspace_id, sprite_name, token_hash, status, step, created_from)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'creating', 'Creating machine', ?7 FROM workspaces WHERE id = ?4`,
    ).bind(deviceId, userId, projectId, workspaceId, spriteName, tokenHash, createBranchFrom),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return { error: "plan_limit", limit: "cloudMachines", max: limits.maxCloudMachines, plan };
  }
  if ((results[1]?.meta.changes ?? 0) === 0) {
    await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(deviceId).run();
    return { error: "not_found" };
  }

  await startMachine(env, {
    seed: { userId, deviceId, projectId, workspaceId, spriteName },
    project: { id: projectId, slug: project.slug, name: project.name },
    workspace: { id: workspaceId, slug, branch: input.branch },
    repoUrl: project.repoUrl,
    branch: input.branch,
    createBranchFrom,
    machineToken: token,
    credential,
  });
  return { workspaceId, deviceId, slug };
}

/** Takes every machine of the project down; the main one last, since its device carries the project. */
export async function destroyCloudProject(
  env: CloudEnv,
  userId: string,
  projectId: string,
): Promise<boolean> {
  // Marked before the machines are read, so none can be added after the list
  // is taken; the mark goes with the row when the main machine's device does.
  const marked = await db(env)
    .update(schema.cloudProjects)
    .set({ deletingAt: new Date() })
    .where(
      and(eq(schema.cloudProjects.projectId, projectId), eq(schema.cloudProjects.userId, userId)),
    )
    .run();
  if (marked.meta.changes === 0) return false;
  const machines = await db(env)
    .select({
      deviceId: schema.cloudMachines.deviceId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(eq(schema.cloudMachines.projectId, projectId), eq(schema.cloudMachines.userId, userId)),
    )
    .all();
  if (machines.length === 0) return false;
  const ordered = [...machines].sort(
    (a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null),
  );
  // One machine's object refusing does not spare the others: the mark above
  // is the intent, and the sweep takes down whatever this loop left.
  for (const machine of ordered) {
    try {
      await env.CLOUD_MACHINE.getByName(machine.deviceId).destroy({
        userId,
        projectId,
        ...machine,
      });
    } catch {
      // Left for `reconcileCloud`, which finishes deleting projects.
    }
  }
  return true;
}

export async function destroyCloudWorkspace(
  env: CloudEnv,
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const machine = await machineOf(env, userId, { projectId, workspaceId });
  if (!machine) return false;
  await env.CLOUD_MACHINE.getByName(machine.deviceId).destroy(machine);
  return true;
}

/** Runs provisioning again for a machine that failed, with a fresh token. */
export async function retryCloudMachine(
  env: CloudEnv,
  userId: string,
  deviceId: string,
): Promise<true | ProvisionError> {
  const row = await db(env)
    .select({
      status: schema.cloudMachines.status,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
      createdFrom: schema.cloudMachines.createdFrom,
    })
    .from(schema.cloudMachines)
    .where(
      and(eq(schema.cloudMachines.deviceId, deviceId), eq(schema.cloudMachines.userId, userId)),
    )
    .get();
  if (!row) return { error: "not_found" };
  if (row.status !== "error") return { error: "not_retryable" };
  if (!(await cloudAccess(env, userId))) return { error: "cloud_disabled" };
  if (!cliSupportsCloud(env.LATEST_CLI_VERSION)) return cliUnsupported(env);
  const project = await cloudProjectOf(env, userId, row.projectId);
  if (!project) return { error: "not_found" };
  const credential = await credentialOf(env, project);
  if (credential === "unavailable") return { error: "credentials_unavailable" };

  let workspace = {
    id: `wsp_${deviceId.slice(4)}`,
    slug: CLOUD_MAIN_WORKSPACE_SLUG,
    branch: project.defaultBranch,
  };
  // A workspace branch that was never cloned is created on the retry, and
  // has to start where it was first asked to.
  let createBranchFrom: string | undefined;
  if (row.workspaceId) {
    const ws = await db(env)
      .select({
        id: schema.workspaces.id,
        slug: schema.workspaces.slug,
        branch: schema.workspaces.branch,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, row.workspaceId))
      .get();
    if (!ws) return { error: "not_found" };
    workspace = { id: ws.id, slug: ws.slug, branch: ws.branch ?? project.defaultBranch };
    createBranchFrom = row.createdFrom ?? project.defaultBranch;
  }

  // The claim is the update itself: two retries that both saw `error` would
  // otherwise mint two tokens, and the machine would be bootstrapped with
  // one while the row keeps the other's hash.
  const token = mintMachineToken(deviceId);
  const claimed = await db(env)
    .update(schema.cloudMachines)
    .set({
      tokenHash: await machineTokenHash(token),
      status: "creating",
      step: "Creating machine",
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.cloudMachines.deviceId, deviceId), eq(schema.cloudMachines.status, "error")),
    )
    .run();
  if (claimed.meta.changes === 0) return { error: "not_retryable" };
  await startMachine(env, {
    seed: {
      userId,
      deviceId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      spriteName: row.spriteName,
    },
    project: { id: project.id, slug: project.slug, name: project.name },
    workspace,
    repoUrl: project.repoUrl,
    branch: workspace.branch,
    createBranchFrom,
    machineToken: token,
    credential,
  });
  return true;
}

export async function setCloudCredential(
  env: CloudEnv,
  userId: string,
  projectId: string,
  credential: Credential | null,
): Promise<true | ProvisionError> {
  if (credential && !env.CLOUD_CREDENTIALS_KEY) return { error: "credentials_unavailable" };
  const result = await db(env)
    .update(schema.cloudProjects)
    .set({
      credentialUsername: credential?.username ?? null,
      credentialCiphertext: credential
        ? await encryptSecret(env.CLOUD_CREDENTIALS_KEY as string, credential.secret)
        : null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.cloudProjects.projectId, projectId), eq(schema.cloudProjects.userId, userId)),
    )
    .run();
  return result.meta.changes === 0 ? { error: "not_found" } : true;
}

/**
 * An https address with nothing in front of the host. A token in the URL
 * would be stored in the clear, listed and shown; the token field exists so
 * that never happens.
 */
export function validRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export async function cloudProjectOf(env: Pick<Env, "DB">, userId: string, projectId: string) {
  return db(env)
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      name: schema.projects.name,
      deviceId: schema.projects.deviceId,
      repoUrl: schema.cloudProjects.repoUrl,
      defaultBranch: schema.cloudProjects.defaultBranch,
      credentialUsername: schema.cloudProjects.credentialUsername,
      credentialCiphertext: schema.cloudProjects.credentialCiphertext,
      deletingAt: schema.cloudProjects.deletingAt,
    })
    .from(schema.cloudProjects)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.cloudProjects.projectId))
    .where(
      and(eq(schema.cloudProjects.projectId, projectId), eq(schema.cloudProjects.userId, userId)),
    )
    .get();
}

async function machineOf(
  env: Pick<Env, "DB">,
  userId: string,
  by: { projectId: string; workspaceId: string },
): Promise<MachineSeed | null> {
  const row = await db(env)
    .select({
      deviceId: schema.cloudMachines.deviceId,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(
        eq(schema.cloudMachines.workspaceId, by.workspaceId),
        eq(schema.cloudMachines.projectId, by.projectId),
        eq(schema.cloudMachines.userId, userId),
      ),
    )
    .get();
  return row ? { userId, ...row } : null;
}

async function credentialOf(
  env: Pick<Env, "CLOUD_CREDENTIALS_KEY">,
  project: { credentialUsername: string | null; credentialCiphertext: string | null },
): Promise<Credential | undefined | "unavailable"> {
  if (!project.credentialCiphertext) return undefined;
  if (!env.CLOUD_CREDENTIALS_KEY) return "unavailable";
  try {
    return {
      username: project.credentialUsername ?? "x-access-token",
      secret: await decryptSecret(env.CLOUD_CREDENTIALS_KEY, project.credentialCiphertext),
    };
  } catch {
    // Encrypted under a key this gateway no longer has: the token itself is
    // gone for good, and the one recovery is to enter it again.
    return "unavailable";
  }
}

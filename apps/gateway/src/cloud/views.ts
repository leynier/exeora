import { CLOUD_MAIN_WORKSPACE_SLUG, type CloudMachineStatus } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { isDeviceOnline, presenceCutoff } from "../presence.js";

/**
 * Exeora Cloud as the dashboard and `exeora cloud` show it: every cloud
 * project of an account with its machines, in two queries rather than one per
 * project. `online` is the presence column, not a relay round trip, for the
 * same reason `/api/devices` reads it that way; a machine that is asleep reads
 * as offline here and wakes on its first call regardless.
 */

export interface CloudMachineView {
  deviceId: string;
  workspaceId: string | null;
  workspaceSlug: string;
  branch: string | null;
  status: CloudMachineStatus;
  step: string | null;
  error: string | null;
  online: boolean;
  createdAt: number;
  readyAt: number | null;
}

export interface CloudProjectView {
  projectId: string;
  slug: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  hasCredential: boolean;
  machines: CloudMachineView[];
}

export async function listCloudProjects(
  env: Pick<Env, "DB">,
  userId: string,
): Promise<CloudProjectView[]> {
  const database = db(env);
  const cutoff = presenceCutoff();

  const projects = await database
    .select({
      projectId: schema.cloudProjects.projectId,
      slug: schema.projects.slug,
      name: schema.projects.name,
      repoUrl: schema.cloudProjects.repoUrl,
      defaultBranch: schema.cloudProjects.defaultBranch,
      credentialCiphertext: schema.cloudProjects.credentialCiphertext,
      createdAt: schema.projects.createdAt,
    })
    .from(schema.cloudProjects)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.cloudProjects.projectId))
    .where(eq(schema.cloudProjects.userId, userId))
    .orderBy(schema.projects.createdAt)
    .all();

  const machines = await database
    .select({
      deviceId: schema.cloudMachines.deviceId,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      status: schema.cloudMachines.status,
      step: schema.cloudMachines.step,
      error: schema.cloudMachines.error,
      createdAt: schema.cloudMachines.createdAt,
      readyAt: schema.cloudMachines.readyAt,
      workspaceSlug: schema.workspaces.slug,
      branch: schema.workspaces.branch,
      lastSeenAt: schema.devices.lastSeenAt,
      disconnectedAt: schema.devices.disconnectedAt,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.cloudMachines)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.cloudMachines.deviceId))
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.cloudMachines.workspaceId))
    .where(eq(schema.cloudMachines.userId, userId))
    .orderBy(schema.cloudMachines.createdAt)
    .all();

  return projects.map((project) => ({
    projectId: project.projectId,
    slug: project.slug,
    name: project.name,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    hasCredential: project.credentialCiphertext !== null,
    machines: machines
      .filter((machine) => machine.projectId === project.projectId)
      .map((machine) => ({
        deviceId: machine.deviceId,
        workspaceId: machine.workspaceId,
        workspaceSlug: machine.workspaceSlug ?? CLOUD_MAIN_WORKSPACE_SLUG,
        branch: machine.workspaceId ? machine.branch : project.defaultBranch,
        status: machine.status,
        step: machine.step,
        error: machine.error,
        online: isDeviceOnline(machine, cutoff),
        createdAt: machine.createdAt.getTime(),
        readyAt: machine.readyAt?.getTime() ?? null,
      })),
  }));
}

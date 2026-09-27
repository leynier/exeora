import { CLOUD_MAIN_WORKSPACE_SLUG } from "@exeora/protocol";
import { and, eq, ne } from "drizzle-orm";
import { isSpriteNameOfThisGateway } from "./cloud/access.js";
import { type HooksView, hooksView } from "./cloud/hooks.js";
import { listSprites, type Sprite } from "./cloud/sprites.js";
import { type ToolsReport, toolsReportOf } from "./cloud/tools-report.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { NOWHERE_KIND } from "./nowhere.js";
import { isDeviceOnline, presenceCutoff } from "./presence.js";

/**
 * Everything that is running for an account, in one list.
 *
 * Two kinds of machine share it: the ones the person owns, which hold copies
 * of several projects, and the ones Exeora Cloud runs, each of which is one
 * workspace of one project. The pages that show machines, whichever way they
 * group them, all read this, so a machine looks and behaves the same wherever
 * it appears.
 */

export type MachineState =
  | "online"
  | "asleep"
  | "offline"
  | "setting up"
  | "failed"
  | "removing"
  | "removed";

interface MachineBase {
  deviceId: string;
  name: string;
  platform: string;
  cliVersion: string | null;
  online: boolean;
  state: MachineState;
  lastSeenAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

export interface LocalMachineView extends MachineBase {
  kind: "local";
  /** The projects that have a copy here. */
  projects: Array<{
    projectId: string;
    slug: string;
    name: string;
    localPath: string | null;
    status: string;
    error: string | null;
    default: boolean;
    workspaces: number;
  }>;
}

export interface CloudMachineView extends MachineBase {
  kind: "cloud";
  project: { id: string; slug: string; name: string };
  /** Null `id` for the machine that holds the project root on Exeora Cloud. */
  workspace: { id: string | null; slug: string; branch: string | null };
  status: string;
  step: string | null;
  error: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  readyAt: number | null;
  /** What the provider says the machine is doing, when it could be asked. */
  runtime: Sprite["status"] | null;
  /** How the project's scripts went on this machine, the last time each ran. */
  hooks: HooksView;
  /** What the machine came with and what was added to it. Null before that step ran. */
  tools: ToolsReport | null;
}

export type MachineView = LocalMachineView | CloudMachineView;

export async function listMachines(
  env: Pick<Env, "DB" | "SPRITES_TOKEN" | "CLOUD_SPRITE_PREFIX" | "LATEST_CLI_VERSION">,
  userId: string,
  options: { live?: boolean; fetcher?: typeof fetch } = {},
): Promise<MachineView[]> {
  const database = db(env);
  const cutoff = presenceCutoff();

  const [devices, locations, machines, counts] = await Promise.all([
    database
      .select()
      .from(schema.devices)
      // The machine that stands for no machine is not one that is running.
      .where(and(eq(schema.devices.userId, userId), ne(schema.devices.kind, NOWHERE_KIND)))
      .orderBy(schema.devices.createdAt)
      .all(),
    database
      .select({
        deviceId: schema.projectLocations.deviceId,
        projectId: schema.projects.id,
        slug: schema.projects.slug,
        name: schema.projects.name,
        defaultDevice: schema.projects.deviceId,
        localPath: schema.projectLocations.localPath,
        status: schema.projectLocations.status,
        error: schema.projectLocations.error,
      })
      .from(schema.projectLocations)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectLocations.projectId))
      .where(eq(schema.projectLocations.userId, userId))
      .orderBy(schema.projects.name)
      .all(),
    database
      .select({
        machine: schema.cloudMachines,
        projectSlug: schema.projects.slug,
        projectName: schema.projects.name,
        defaultBranch: schema.cloudProjects.defaultBranch,
        workspaceSlug: schema.workspaces.slug,
        branch: schema.workspaces.branch,
      })
      .from(schema.cloudMachines)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.cloudMachines.projectId))
      .leftJoin(
        schema.cloudProjects,
        eq(schema.cloudProjects.projectId, schema.cloudMachines.projectId),
      )
      .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.cloudMachines.workspaceId))
      .where(eq(schema.cloudMachines.userId, userId))
      .all(),
    env.DB.prepare(
      `SELECT w.project_id AS projectId, COALESCE(w.device_id, p.device_id) AS deviceId, COUNT(*) AS n
         FROM workspaces w
         JOIN projects p ON p.id = w.project_id
        WHERE p.user_id = ?1
        GROUP BY w.project_id, COALESCE(w.device_id, p.device_id)`,
    )
      .bind(userId)
      .all<{ projectId: string; deviceId: string; n: number }>(),
  ]);

  const runtime = options.live ? await spriteStates(env, options.fetcher ?? fetch) : new Map();
  const cloud = new Map(machines.map((row) => [row.machine.deviceId, row]));
  const workspacesOn = (projectId: string, deviceId: string) =>
    counts.results.find((row) => row.projectId === projectId && row.deviceId === deviceId)?.n ?? 0;

  return devices.map((device): MachineView => {
    const online = isDeviceOnline(device, cutoff);
    const base: MachineBase = {
      deviceId: device.id,
      name: device.name,
      platform: device.platform,
      cliVersion: device.cliVersion,
      online,
      state: device.revokedAt ? "removed" : online ? "online" : "offline",
      lastSeenAt: device.lastSeenAt?.getTime() ?? null,
      createdAt: device.createdAt.getTime(),
      revokedAt: device.revokedAt?.getTime() ?? null,
    };

    const row = cloud.get(device.id);
    if (!row) {
      return {
        ...base,
        kind: "local",
        projects: locations
          .filter((location) => location.deviceId === device.id)
          .map((location) => ({
            projectId: location.projectId,
            slug: location.slug,
            name: location.name,
            localPath: location.localPath,
            status: location.status,
            error: location.error,
            default: location.defaultDevice === device.id,
            workspaces: workspacesOn(location.projectId, device.id),
          })),
      };
    }

    const { machine } = row;
    const state: MachineState =
      machine.status === "creating"
        ? "setting up"
        : machine.status === "error"
          ? "failed"
          : machine.status === "destroying"
            ? "removing"
            : online
              ? "online"
              : "asleep";
    return {
      ...base,
      kind: "cloud",
      state,
      project: { id: machine.projectId, slug: row.projectSlug, name: row.projectName },
      workspace: {
        id: machine.workspaceId,
        slug: row.workspaceSlug ?? CLOUD_MAIN_WORKSPACE_SLUG,
        branch: machine.workspaceId ? row.branch : row.defaultBranch,
      },
      status: machine.status,
      step: machine.step,
      error: machine.error,
      errorCode: machine.errorCode,
      errorDetail: machine.errorDetail,
      readyAt: machine.readyAt?.getTime() ?? null,
      runtime: runtime.get(machine.spriteName) ?? null,
      hooks: hooksView(env, machine, device.cliVersion),
      tools: toolsReportOf(machine.toolsReport),
    };
  });
}

/**
 * What the provider says each machine is doing, by name. One request for all
 * of them, and a failure is an empty answer: the page still has the machine's
 * own presence to show, and must not wait on somebody else's API to load.
 */
async function spriteStates(
  env: Pick<Env, "SPRITES_TOKEN" | "CLOUD_SPRITE_PREFIX">,
  fetcher: typeof fetch,
): Promise<Map<string, Sprite["status"]>> {
  const states = new Map<string, Sprite["status"]>();
  if (!env.SPRITES_TOKEN) return states;
  try {
    const sprites = await listSprites({ token: env.SPRITES_TOKEN }, fetcher, {
      prefix: `${env.CLOUD_SPRITE_PREFIX || "exeora"}-`,
    });
    for (const sprite of sprites) {
      if (isSpriteNameOfThisGateway(env, sprite.name)) states.set(sprite.name, sprite.status);
    }
  } catch (error) {
    console.error("could not read the state of the cloud machines", error);
  }
  return states;
}

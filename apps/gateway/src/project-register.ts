import { and, eq, isNotNull } from "drizzle-orm";
import { planOf } from "./api/plan.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { newId } from "./ids.js";
import { putLocalLocation, setDefaultLocation } from "./locations.js";
import { limitsFor, type PlanId } from "./plans.js";

/**
 * What `exeora project add` turns into.
 *
 * Three answers, tried in this order. The checkout's repository is already a
 * project: this machine joins it. The name is already a project on this very
 * machine: it is the same registration again, and is brought up to date. It is
 * neither: a project is made. What is refused is the fourth case, a name that
 * belongs to something else on another machine, which used to move the project
 * here without a word and leave the other machine holding nothing.
 */

export interface Registration {
  deviceId: string;
  name: string;
  slug: string;
  localPath: string;
}

export interface Repository {
  repoUrl: string | null;
  repoKey: string;
  defaultBranch: string | null;
}

export type Registered =
  | {
      id: string;
      slug: string;
      name: string;
      created: boolean;
      /** `created` made the project, `joined` added this machine to one, `updated` changed neither. */
      location: "created" | "joined" | "updated";
    }
  | { error: "device_revoked" }
  | { error: "cloud_project" }
  | { error: "slug_taken"; message: string; machine: string | null }
  | { error: "plan_limit"; limit: "projects"; max: number | null; plan: PlanId };

export async function registerProject(
  env: Pick<Env, "DB">,
  userId: string,
  input: Registration,
  repository: Repository | null,
): Promise<Registered> {
  const database = db(env);

  if (repository) {
    // The oldest, so that an account holding the same repository twice from
    // before this rule keeps sending new machines to the same one.
    const same = await database
      .select()
      .from(schema.projects)
      .where(
        and(eq(schema.projects.userId, userId), eq(schema.projects.repoKey, repository.repoKey)),
      )
      .orderBy(schema.projects.createdAt)
      .get();
    if (same) return join(env, userId, same, input, repository);
  }

  const named = await database
    .select({
      project: schema.projects,
      cloud: schema.cloudProjects.projectId,
      machine: schema.devices.name,
      machineRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.projects)
    .leftJoin(schema.cloudProjects, eq(schema.cloudProjects.projectId, schema.projects.id))
    .leftJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.slug, input.slug)))
    .get();

  if (!named) return create(env, userId, input, repository);

  const { project } = named;
  const here =
    project.deviceId === input.deviceId ||
    (await database
      .select({ id: schema.projectLocations.id })
      .from(schema.projectLocations)
      .where(
        and(
          eq(schema.projectLocations.projectId, project.id),
          eq(schema.projectLocations.deviceId, input.deviceId),
        ),
      )
      .get()) !== undefined;

  // A machine that was registered again gets a new id, and the project it
  // held is still named after the old one. That is the same machine asking
  // for its project back, not a second one taking it.
  if (here || (named.machineRevokedAt !== null && !named.cloud)) {
    // Learned now if it was not known: a project registered by a CLI that did
    // not send its remote becomes one that other machines can join.
    const adopted = repository !== null && project.repoKey === null;
    return join(env, userId, project, input, adopted ? repository : null, {
      rename: true,
      takeDefault: !here,
    });
  }

  // A repository on Exeora Cloud is joined by its remote, above. A checkout
  // that only shares its name is something else.
  if (named.cloud) return { error: "cloud_project" };

  return {
    error: "slug_taken",
    machine: named.machine,
    message: `A project called ${input.slug} already lives on ${named.machine ?? "another machine"}, and this directory is not a checkout of the same repository. Add it under another name, or remove the other one first.`,
  };
}

async function join(
  env: Pick<Env, "DB">,
  userId: string,
  project: typeof schema.projects.$inferSelect,
  input: Registration,
  repository: Repository | null,
  options: { rename?: boolean; takeDefault?: boolean } = {},
): Promise<Registered> {
  const database = db(env);
  const already = await database
    .select({ id: schema.projectLocations.id })
    .from(schema.projectLocations)
    .where(
      and(
        eq(schema.projectLocations.projectId, project.id),
        eq(schema.projectLocations.deviceId, input.deviceId),
      ),
    )
    .get();

  await putLocalLocation(env, {
    userId,
    projectId: project.id,
    deviceId: input.deviceId,
    localPath: input.localPath,
    status: "ready",
  });

  const fill = {
    ...(options.rename ? { name: input.name } : {}),
    ...(repository && project.repoKey === null
      ? { repoUrl: repository.repoUrl, repoKey: repository.repoKey }
      : {}),
    ...(repository?.defaultBranch && project.defaultBranch === null
      ? { defaultBranch: repository.defaultBranch }
      : {}),
  };
  if (Object.keys(fill).length > 0) {
    await database
      .update(schema.projects)
      .set(fill)
      .where(and(eq(schema.projects.id, project.id), eq(schema.projects.userId, userId)))
      .run();
  }

  if (options.takeDefault) {
    const location = await database
      .select({ id: schema.projectLocations.id })
      .from(schema.projectLocations)
      .where(
        and(
          eq(schema.projectLocations.projectId, project.id),
          eq(schema.projectLocations.deviceId, input.deviceId),
        ),
      )
      .get();
    const moved = await setDefaultLocation(env, userId, project, {
      id: location?.id ?? "",
      deviceId: input.deviceId,
      localPath: input.localPath,
      state: "online",
    });
    // The location was written a moment ago by id of its machine, so the only
    // way this misses is a project that went away meanwhile.
    if (moved !== true) return { error: "device_revoked" };
  }

  const wasHere = already !== undefined || project.deviceId === input.deviceId;
  return {
    id: project.id,
    slug: project.slug,
    name: options.rename ? input.name : project.name,
    created: false,
    location: wasHere ? "updated" : "joined",
  };
}

async function create(
  env: Pick<Env, "DB">,
  userId: string,
  input: Registration,
  repository: Repository | null,
): Promise<Registered> {
  const id = newId("prj");
  const plan = await planOf(env, userId);
  const limits = limitsFor(plan);

  // Same atomic pattern as devices: the cap lives in the INSERT, not in a
  // prior SELECT that a second request could race. The location is selected
  // out of the project, so one that was refused leaves nothing behind it.
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO projects (id, user_id, device_id, name, slug, local_path, repo_url, repo_key, default_branch)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
         FROM devices
        WHERE id = ?3 AND user_id = ?2 AND revoked_at IS NULL
          AND (?10 IS NULL OR (SELECT COUNT(*) FROM projects WHERE user_id = ?2) < ?10)`,
    ).bind(
      id,
      userId,
      input.deviceId,
      input.name,
      input.slug,
      input.localPath,
      repository?.repoUrl ?? null,
      repository?.repoKey ?? null,
      repository?.defaultBranch ?? null,
      limits.maxProjects,
    ),
    env.DB.prepare(
      `INSERT INTO project_locations (id, project_id, user_id, kind, device_id, local_path, status)
       SELECT ?1, id, user_id, 'local', device_id, local_path, 'ready' FROM projects WHERE id = ?2`,
    ).bind(newId("loc"), id),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const active = await db(env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.id, input.deviceId),
          eq(schema.devices.userId, userId),
          isNotNull(schema.devices.revokedAt),
        ),
      )
      .get();
    if (active) return { error: "device_revoked" };
    return { error: "plan_limit", limit: "projects", max: limits.maxProjects, plan };
  }

  return { id, slug: input.slug, name: input.name, created: true, location: "created" };
}

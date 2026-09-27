import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { addCloudLocation, type CloudLocationError, createCloudRoot } from "../cloud/location.js";
import { destroyCloudLocation } from "../cloud/teardown.js";
import { db, schema } from "../db/client.js";
import { LOCATION_STATUSES } from "../db/schema-locations.js";
import "../env.js";
import {
  type LocationView,
  locationsOf,
  putLocalLocation,
  setDefaultLocation,
} from "../locations.js";
import { keepRepositoriesStatements } from "../locations-default.js";
import type { ApiEnv } from "./router.js";

/**
 * The places a project lives: the user's machines and Exeora Cloud.
 *
 * Adding a machine costs nothing and clones nothing. It says the project may
 * live there, and the first workspace made on that machine is what brings the
 * copy: the CLI clones into the machine's projects folder, or takes a checkout
 * of the same repository that is already in it.
 */

export const locations = new Hono<ApiEnv>();

async function ownedProject(env: Pick<Env, "DB">, userId: string, projectId: string) {
  return db(env)
    .select({
      id: schema.projects.id,
      deviceId: schema.projects.deviceId,
      localPath: schema.projects.localPath,
      repoUrl: schema.projects.repoUrl,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
}

async function listed(
  env: Pick<Env, "DB">,
  userId: string,
  project: { id: string; deviceId: string; localPath: string },
): Promise<LocationView[]> {
  return (await locationsOf(env, userId, [project])).get(project.id) ?? [];
}

locations.get("/api/projects/:id/locations", async (c) => {
  const project = await ownedProject(c.env, c.get("userId"), c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ locations: await listed(c.env, c.get("userId"), project) });
});

const addInput = z.union([
  z.object({ kind: z.literal("local").default("local"), deviceId: z.string().min(1) }),
  z.object({
    kind: z.literal("cloud"),
    token: z.string().min(1).max(500).optional(),
    username: z.string().min(1).max(200).optional(),
  }),
]);

locations.post("/api/projects/:id/locations", zValidator("json", addInput), async (c) => {
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const project = await ownedProject(c.env, userId, c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);

  if (body.kind === "cloud") {
    const added = await addCloudLocation(c.env, userId, project.id, {
      credential: body.token
        ? { username: body.username ?? "x-access-token", secret: body.token }
        : undefined,
    });
    if (added !== true) return cloudFailure(c, added);
    return c.json({ locations: await listed(c.env, userId, project) }, 201);
  }

  // Without a repository there is nothing another machine could clone: the
  // project is a directory, and it is where it is.
  if (!project.repoUrl) {
    return c.json(
      {
        error: "no_repository",
        message:
          "This project has no repository, so it cannot be cloned onto another machine. Give its checkout a remote and run `exeora sync` there.",
      },
      422,
    );
  }

  const device = await db(c.env)
    .select({ kind: schema.devices.kind, revokedAt: schema.devices.revokedAt })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, body.deviceId), eq(schema.devices.userId, userId)))
    .get();
  if (!device) return c.json({ error: "unknown_device" }, 400);
  if (device.revokedAt) return c.json({ error: "device_revoked" }, 409);
  if (device.kind === "cloud") return c.json({ error: "cloud_device" }, 400);

  const before = await listed(c.env, userId, project);
  if (!before.some((location) => location.deviceId === body.deviceId)) {
    await putLocalLocation(c.env, {
      userId,
      projectId: project.id,
      deviceId: body.deviceId,
      status: "pending",
    });
  }
  return c.json({ locations: await listed(c.env, userId, project) }, 201);
});

const reportInput = z.object({
  status: z.enum(LOCATION_STATUSES),
  localPath: z.string().min(1).max(1000).optional(),
  error: z.string().max(2000).nullable().optional(),
  errorCode: z.string().max(60).nullable().optional(),
});

/**
 * What the CLI on a machine says about its copy: that it is cloning, where the
 * copy ended up, or why there is none.
 */
locations.put(
  "/api/projects/:id/locations/:deviceId",
  zValidator("json", reportInput),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const deviceId = c.req.param("deviceId");
    const project = await ownedProject(c.env, userId, c.req.param("id"));
    if (!project) return c.json({ error: "not_found" }, 404);

    const device = await db(c.env)
      .select({ kind: schema.devices.kind, revokedAt: schema.devices.revokedAt })
      .from(schema.devices)
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
      .get();
    if (!device || device.kind === "cloud") return c.json({ error: "unknown_device" }, 400);
    if (device.revokedAt) return c.json({ error: "device_revoked" }, 409);

    await putLocalLocation(c.env, {
      userId,
      projectId: project.id,
      deviceId,
      localPath: body.localPath,
      status: body.status,
      error: body.status === "error" ? (body.error ?? "The repository could not be cloned.") : null,
      errorCode: body.status === "error" ? (body.errorCode ?? "setup_failed") : null,
    });
    return c.json({ locations: await listed(c.env, userId, project) });
  },
);

locations.put(
  "/api/projects/:id/default-location",
  zValidator("json", z.object({ locationId: z.string().min(1) })),
  async (c) => {
    const userId = c.get("userId");
    const project = await ownedProject(c.env, userId, c.req.param("id"));
    if (!project) return c.json({ error: "not_found" }, 404);

    const all = await listed(c.env, userId, project);
    let location = all.find((entry) => entry.id === c.req.valid("json").locationId);
    if (!location) return c.json({ error: "not_found" }, 404);

    // Cloud that holds only workspaces has no machine for the project root.
    // Making it the default is what asks for one.
    if (location.kind === "cloud" && location.deviceId === null) {
      const root = await createCloudRoot(c.env, userId, project.id);
      if ("error" in root) return cloudFailure(c, root);
      location = { ...location, deviceId: root.deviceId, state: "setting up" };
    }

    const moved = await setDefaultLocation(c.env, userId, project, location);
    if (moved !== true) {
      return c.json({ error: moved }, moved === "not_found" ? 404 : 409);
    }
    const fresh = await ownedProject(c.env, userId, project.id);
    return c.json({ locations: fresh ? await listed(c.env, userId, fresh) : [] });
  },
);

/**
 * Takes a project off one of the places it lives.
 *
 * The gateway forgets the location and the workspaces it knew there. Nothing
 * on the user's own machine is touched: the checkout and its worktrees stay
 * where they are, no longer served. On Exeora Cloud the machines are what the
 * location is, so they are taken down.
 *
 * A repository may lose the only place it lives: it is kept, with nowhere to
 * live, until it is given a place again. A directory with no remote may not,
 * because it is the copy on that machine and nothing else.
 */
locations.delete("/api/projects/:id/locations/:locationId", async (c) => {
  const userId = c.get("userId");
  const project = await ownedProject(c.env, userId, c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);

  const all = await listed(c.env, userId, project);
  const location = all.find((entry) => entry.id === c.req.param("locationId"));
  if (!location) return c.json({ error: "not_found" }, 404);
  // A machine that was removed is not somewhere the project lives, so it does
  // not make another location safe to take away.
  const standing = all.filter((entry) => entry.state !== "removed");
  const last = location.state !== "removed" && standing.length === 1;
  if (last && !project.repoUrl) {
    return c.json(
      {
        error: "last_location",
        message:
          "This project is a directory on this machine and lives nowhere else. Remove the project instead.",
      },
      409,
    );
  }
  if (location.default && !last) {
    return c.json(
      {
        error: "default_location",
        message: "Choose another default location before removing this one.",
      },
      409,
    );
  }

  // With its last place gone the project lives nowhere, whatever machine it
  // was on. That is not always the one being removed: the default may be a
  // machine that was revoked and is still listed, and a project left on it
  // would be one nobody can reach or give a place to.
  const leaves = last
    ? keepRepositoriesStatements(c.env, userId, project.deviceId, project.id)
    : [];

  if (location.kind === "cloud") {
    if (leaves.length > 0) await c.env.DB.batch(leaves);
    await destroyCloudLocation(c.env, userId, project.id);
    return c.json({ ok: true }, 202);
  }

  await c.env.DB.batch([
    // Workspaces older than locations name no machine and are the default's,
    // so they go when the default does: removed here, or left behind above.
    c.env.DB.prepare(
      `DELETE FROM workspaces
        WHERE project_id = ?1 AND (device_id = ?2 OR (device_id IS NULL AND ?4))
          AND project_id IN (SELECT id FROM projects WHERE user_id = ?3)`,
    ).bind(project.id, location.deviceId, userId, location.default || last ? 1 : 0),
    ...leaves,
    c.env.DB.prepare("DELETE FROM project_locations WHERE id = ?1 AND user_id = ?2").bind(
      location.id,
      userId,
    ),
  ]);
  return c.json({ ok: true });
});

function cloudFailure(
  c: { json: (body: unknown, status: 403 | 404 | 409 | 422 | 503) => Response },
  error: CloudLocationError,
) {
  switch (error.error) {
    case "cloud_disabled":
      return c.json({ error: "cloud_disabled" }, 403);
    case "plan_limit":
      return c.json(error, 403);
    case "cli_unsupported":
      return c.json(error, 503);
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "slug_conflict":
    case "not_retryable":
      return c.json({ error: error.error }, 409);
    case "credentials_unavailable":
      return c.json(
        {
          error: "credentials_unavailable",
          message: "This gateway has no key for repository tokens.",
        },
        422,
      );
    default:
      return c.json(error, 422);
  }
}

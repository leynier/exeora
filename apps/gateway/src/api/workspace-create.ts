import { ExeoraError } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { beginAudit, finishAudit } from "../audit.js";
import { addCloudLocation } from "../cloud/location.js";
import { createCloudWorkspace } from "../cloud/provisioning.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import {
  CLOUD_LOCATION_SLUG,
  findLocation,
  type LocationView,
  locationNames,
  locationsOf,
} from "../locations.js";
import { callRelayWorkspace } from "../relay-client.js";
import { prepareLocation } from "../workspace-placement.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * Making a workspace from the dashboard, wherever the project lives.
 *
 * One request for every place: a worktree on one of the user's machines, which
 * is cloned first when that machine has no copy, or a machine of its own on
 * Exeora Cloud. The page that asks does not have to know which of those it is
 * before asking, only where.
 */

export const workspaceCreate = new Hono<ApiEnv>();

const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens.")
  .refine((value) => value !== "main", "main is reserved");

const input = z.object({
  branch: z.string().min(1).max(255),
  from: z.string().min(1).max(512).optional(),
  reuseExistingBranch: z.boolean().default(false),
  name: z.string().min(1).max(100).optional(),
  slug: slug.optional(),
  /** A location by id, slug or name, or `cloud`. The default location when absent. */
  where: z.string().min(1).max(200).optional(),
});

workspaceCreate.post("/api/projects/:id/workspaces", zValidator("json", input), async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const body = c.req.valid("json");

  const project = await db(c.env)
    .select({
      id: schema.projects.id,
      deviceId: schema.projects.deviceId,
      localPath: schema.projects.localPath,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!project) return c.json({ error: "not_found" }, 404);

  const read = async () => (await locationsOf(c.env, userId, [project])).get(project.id) ?? [];
  let locations = await read();
  let location = findLocation(locations, body.where);

  // Asking for a workspace on Cloud is asking for the project to be there.
  if (!location && body.where?.trim().toLowerCase() === CLOUD_LOCATION_SLUG) {
    const added = await addCloudLocation(c.env, userId, projectId);
    if (added !== true) {
      return c.json(added, added.error === "cloud_disabled" ? 403 : 422);
    }
    locations = await read();
    location = findLocation(locations, CLOUD_LOCATION_SLUG);
  }
  if (!location) {
    return c.json(
      {
        error: "unknown_location",
        message: `This project does not live there. Its locations are: ${locationNames(locations)}.`,
      },
      422,
    );
  }

  if (location.kind === "cloud") {
    const created = await createCloudWorkspace(c.env, userId, projectId, {
      branch: body.branch,
      from: body.from,
      name: body.name,
      slug: body.slug,
    });
    if ("error" in created) {
      const status =
        created.error === "cloud_disabled" || created.error === "plan_limit"
          ? 403
          : created.error === "not_found"
            ? 404
            : created.error === "slug_conflict"
              ? 409
              : created.error === "cli_unsupported"
                ? 503
                : 422;
      return c.json(created, status);
    }
    return c.json({ ...created, where: location.slug, status: "creating" }, 202);
  }

  return createOnMachine(c, { userId, projectId, location, body });
});

async function createOnMachine(
  c: Context<ApiEnv>,
  call: {
    userId: string;
    projectId: string;
    location: LocationView;
    body: z.infer<typeof input>;
  },
) {
  const { userId, projectId, location, body } = call;
  if (location.deviceId === null || location.state === "removed") {
    return c.json({ error: "machine_removed", message: `${location.name} was removed.` }, 409);
  }

  const audit = await beginAudit(c.env, {
    userId,
    projectId,
    tool: "source_control.workspace_create",
    endpoint: "dashboard",
    caller: { clientId: undefined, clientName: "Exeora Dashboard", mcp: undefined },
  });
  try {
    await prepareLocation(c.env, { userId, projectId, location, signal: c.req.raw.signal });
    const value = await callRelayWorkspace(
      c.env.DEVICE_RELAY.getByName(relayName(userId, location.deviceId)),
      {
        requestId: newId("req"),
        projectId,
        action: {
          action: "workspace_create",
          branch: body.branch,
          from: body.from,
          reuseExistingBranch: body.reuseExistingBranch,
          name: body.name,
          slug: body.slug,
        },
        signal: c.req.raw.signal,
      },
    );
    await finishAudit(c.env, audit, { status: "ok" });
    if (value.kind !== "mutation" || !value.workspace) {
      return c.json({ error: "INTERNAL_ERROR", message: "The machine made no workspace." }, 500);
    }
    return c.json({ workspace: value.workspace, where: location.slug, status: "ready" }, 201);
  } catch (error) {
    const code = error instanceof ExeoraError ? error.code : "INTERNAL_ERROR";
    await finishAudit(c.env, audit, { status: "error", errorCode: code });
    if (!(error instanceof ExeoraError)) {
      console.error("workspace creation failed", error);
      return c.json({ error: code, message: "The workspace could not be created." }, 500);
    }
    const status =
      code === "LOCAL_EXECUTOR_OFFLINE" || code === "EXECUTOR_WAKING" || code === "TOOL_TIMEOUT"
        ? 409
        : code === "FORBIDDEN"
          ? 403
          : 422;
    return c.json({ error: code, message: error.message }, status);
  }
}

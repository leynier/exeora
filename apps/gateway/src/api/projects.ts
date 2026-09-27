import { CommandPolicy, httpsRepositoryUrl, repositoryKey } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { grantNewProject } from "../account-access.js";
import { ownedProjectDeletionStatement } from "../audit-deletions.js";
import { parsePolicy } from "../clients.js";
import { destroyCloudProject } from "../cloud/provisioning.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { locationsOf } from "../locations.js";
import { registerProject } from "../project-register.js";
import type { ApiEnv } from "./router.js";

/**
 * The projects of an account, one row per repository wherever it lives, and
 * the command policy that applies inside them.
 */

export const projects = new Hono<ApiEnv>();

const projectInput = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens."),
  localPath: z.string().min(1).max(1000),
  /** The checkout's remote, when it has one. What makes it the same project on another machine. */
  repoUrl: z.string().min(1).max(1000).optional(),
  defaultBranch: z.string().min(1).max(255).optional(),
});

/**
 * Registers a directory on a machine.
 *
 * One repository is one project. A checkout whose remote is already a project
 * of this account joins it as another location, whatever the directory is
 * called; only a repository the account has not seen, or a directory with no
 * remote, becomes a project of its own.
 */
projects.post("/api/projects", zValidator("json", projectInput), async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");

  // Checked rather than trusted: the device id arrives from the client.
  const device = await db(c.env)
    .select({
      id: schema.devices.id,
      kind: schema.devices.kind,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, body.deviceId), eq(schema.devices.userId, userId)))
    .get();
  if (!device) return c.json({ error: "unknown_device" }, 400);
  if (device.revokedAt) return c.json({ error: "device_revoked" }, 409);
  // A cloud machine serves exactly the repository it was created for; its
  // projects are made through the Cloud routes, never registered onto it.
  if (device.kind === "cloud") return c.json({ error: "cloud_device" }, 400);

  const repoKey = repositoryKey(body.repoUrl);
  const repository = repoKey
    ? {
        repoUrl: httpsRepositoryUrl(body.repoUrl ?? "") ?? body.repoUrl ?? null,
        repoKey,
        defaultBranch: body.defaultBranch ?? null,
      }
    : null;

  const registered = await registerProject(c.env, userId, body, repository);
  if ("error" in registered) {
    return c.json(registered, registered.error === "plan_limit" ? 403 : 409);
  }
  if (registered.created) await grantNewProject(c.env, { userId, projectId: registered.id });

  return c.json(
    {
      id: registered.id,
      slug: registered.slug,
      name: registered.name,
      // `joined` is a machine that became one more place an existing project
      // lives; the CLI says so rather than announcing a new project.
      location: registered.location,
    },
    registered.created ? 201 : 200,
  );
});

projects.get("/api/projects", async (c) => {
  const userId = c.get("userId");
  // The cloud row rides along so the dashboard can tell a repository on an
  // Exeora machine from a directory on the user's own, in one request.
  const rows = await db(c.env)
    .select({
      project: schema.projects,
      cloudRepoUrl: schema.cloudProjects.repoUrl,
      cloudBranch: schema.cloudProjects.defaultBranch,
      hasCredential: schema.cloudProjects.credentialCiphertext,
      github: schema.githubRepositories,
    })
    .from(schema.projects)
    .leftJoin(schema.cloudProjects, eq(schema.cloudProjects.projectId, schema.projects.id))
    .leftJoin(
      schema.githubRepositories,
      eq(schema.githubRepositories.projectId, schema.projects.id),
    )
    .where(eq(schema.projects.userId, userId))
    .orderBy(schema.projects.name)
    .all();

  const locations = await locationsOf(
    c.env,
    userId,
    rows.map(({ project }) => project),
  );

  return c.json(
    rows.map(({ project, cloudRepoUrl, cloudBranch, hasCredential, github }) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      /** The machine of the default location. */
      deviceId: project.deviceId,
      localPath: project.localPath,
      repoUrl: project.repoUrl,
      defaultBranch: project.defaultBranch,
      locations: locations.get(project.id) ?? [],
      mcpUrl: new URL(`/p/${project.id}/mcp`, c.env.EXEORA_BASE_URL).toString(),
      policy: parsePolicy(project.commandPolicy),
      createdAt: project.createdAt.getTime(),
      cloud:
        cloudRepoUrl !== null && cloudBranch !== null
          ? {
              repoUrl: cloudRepoUrl,
              defaultBranch: cloudBranch,
              hasCredential: hasCredential !== null,
            }
          : null,
      /** The repository the project clones through GitHub as, when it was connected. */
      github: github
        ? {
            fullName: github.fullName,
            private: github.private,
            lostAccess: github.lostAccessAt !== null,
          }
        : null,
    })),
  );
});

/**
 * Sets what an agent may do in this project.
 *
 * Validated against the shared schema rather than a copy, so a policy the
 * dashboard can save is one the executor will understand. Stored as JSON in one
 * column because it is read and written whole and never queried by its parts.
 */
projects.put("/api/projects/:id/policy", zValidator("json", CommandPolicy), async (c) => {
  const policy = c.req.valid("json");

  const result = await db(c.env)
    .update(schema.projects)
    .set({ commandPolicy: JSON.stringify(policy) })
    .where(
      and(eq(schema.projects.id, c.req.param("id")), eq(schema.projects.userId, c.get("userId"))),
    )
    .run();

  if (result.meta.changes === 0) return c.json({ error: "not_found" }, 404);

  // No cache to clear and no socket to notify: the policy travels with the next
  // tool call, so this takes effect on the very next one.
  return c.json(policy);
});

projects.delete("/api/projects/:id", async (c) => {
  const projectId = c.req.param("id");
  const userId = c.get("userId");
  // A project on Exeora Cloud has machines there: those are taken down first,
  // and the last of them to go removes the project's row.
  if (await destroyCloudProject(c.env, userId, projectId)) return c.json({ ok: true }, 202);
  const results = await c.env.DB.batch([
    ownedProjectDeletionStatement(c.env, userId, projectId),
    c.env.DB.prepare("DELETE FROM audit_outbox WHERE project_id = ?1 AND user_id = ?2").bind(
      projectId,
      userId,
    ),
    c.env.DB.prepare("DELETE FROM projects WHERE id = ?1 AND user_id = ?2").bind(projectId, userId),
  ]);

  if ((results.at(-1)?.meta.changes ?? 0) === 0) return c.json({ error: "not_found" }, 404);

  return c.json({ ok: true });
});

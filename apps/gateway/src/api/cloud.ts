import { repositoryKey } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { grantNewProject } from "../account-access.js";
import { cloudAccess } from "../cloud/access.js";
import { addCloudLocation } from "../cloud/location.js";
import {
  createCloudProject,
  createCloudWorkspace,
  destroyCloudProject,
  destroyCloudWorkspace,
  type ProvisionError,
  retryCloudMachine,
  setCloudCredential,
  validRepoUrl,
} from "../cloud/provisioning.js";
import { probeRepository } from "../cloud/repository.js";
import { listCloudProjects } from "../cloud/views.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { GitHubError, GitHubReconnectError, githubConfig } from "../github/app.js";
import { linkProjectStatement } from "../github/links.js";
import { outbound } from "../github/outbound.js";
import { pickedRepository, projectSlug } from "../github/repositories.js";
import type { ApiEnv } from "./router.js";

/**
 * Exeora Cloud from the outside: the repositories an account has put on
 * machines Exeora runs, and the machines themselves.
 *
 * Every mutation answers 202. Creating a machine takes a minute the request
 * cannot wait for; the rows it leaves behind carry the state, and the list
 * route is what the dashboard and `exeora cloud` poll until it settles.
 */

export const cloud = new Hono<ApiEnv>();

// No gate on the router: listing and removing machines stay open to the
// account that has them, so switching Cloud off for an account leaves it
// able to see and take down what it made. What makes a machine (creating a
// project or a workspace, retrying one) checks `cloudAccess` in provisioning,
// where the workspace tools reach it too.

const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens.");

const projectInput = z
  .object({
    name: z.string().min(1).max(100).optional(),
    slug: slug.optional(),
    repoUrl: z
      .string()
      .url()
      .max(1000)
      .refine(
        validRepoUrl,
        "Use an https:// URL with the token in the token field, not in the address.",
      )
      .optional(),
    /** Left out, it is the branch the repository itself calls its default. */
    defaultBranch: z.string().min(1).max(255).optional(),
    token: z.string().min(1).max(500).optional(),
    username: z.string().min(1).max(200).optional(),
    /**
     * A repository picked from the account's connection to GitHub, which
     * then says the address, the branch and the name, and clones with the
     * connection rather than with a token.
     */
    github: z
      .object({
        repositoryId: z.number().int().positive(),
        installationId: z.number().int().positive(),
      })
      .optional(),
    /** Clients on the account URL that should reach the project from the start. */
    clientIds: z.array(z.string().min(1).max(2000)).max(50).optional(),
  })
  .refine(
    (body) =>
      body.github !== undefined ||
      (body.name !== undefined && body.slug !== undefined && body.repoUrl !== undefined),
    "Give a name, a slug and a repoUrl, or pick a repository with github.",
  );

const workspaceInput = z.object({
  branch: z.string().min(1).max(255),
  from: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(100).optional(),
  slug: slug.refine((value) => value !== "main", "main is reserved").optional(),
});

const credentialInput = z.object({
  token: z.string().min(1).max(500).nullable(),
  username: z.string().min(1).max(200).optional(),
});

cloud.get("/api/cloud/projects", async (c) =>
  c.json({ projects: await listCloudProjects(c.env, c.get("userId")) }),
);

cloud.post("/api/cloud/projects", zValidator("json", projectInput), async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");
  // Before anything is asked of another host: an account that may not make
  // machines gets no answers about repositories through this route either.
  if (!(await cloudAccess(c.env, userId))) return failed(c, { error: "cloud_disabled" });

  let picked: Awaited<ReturnType<typeof pickedRepository>> = null;
  if (body.github) {
    if (!githubConfig(c.env)) return c.json({ error: "github_disabled" }, 404);
    try {
      picked = await pickedRepository(c.env, userId, body.github, outbound());
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      if (error instanceof GitHubReconnectError) {
        return c.json({ error: "github_reconnect", message: error.message }, 409);
      }
      return c.json({ error: "github_unavailable", message: error.message }, 422);
    }
    if (!picked) {
      return c.json(
        {
          error: "github_not_connected",
          message:
            "That repository is not one this account can reach through GitHub. Check that you can open it there and that the app was given it, then pick it again.",
        },
        422,
      );
    }
  }
  const repoUrl = picked?.url ?? body.repoUrl ?? "";
  const name = body.name ?? picked?.name ?? "";
  // A picked repository clones through the connection, so a token sent along
  // with it would be stored and never read.
  const credential =
    !picked && body.token
      ? { username: body.username ?? "x-access-token", secret: body.token }
      : undefined;

  // One repository is one project. A repository the account already has,
  // on somebody's laptop say, is put on Cloud as one more place it lives,
  // rather than made again under a second name with a second URL.
  const key = repositoryKey(repoUrl);
  const same = key
    ? await db(c.env)
        .select({ id: schema.projects.id, defaultBranch: schema.projects.defaultBranch })
        .from(schema.projects)
        .where(and(eq(schema.projects.userId, userId), eq(schema.projects.repoKey, key)))
        .orderBy(schema.projects.createdAt)
        .get()
    : undefined;

  // The branch comes from whoever knows it: the caller, GitHub, a project
  // that already has one, and last the repository itself. Never a guess: a
  // repository whose work is on `master` would get a machine that cannot
  // start, a minute after the dialog that asked for it was closed.
  let defaultBranch = body.defaultBranch ?? picked?.defaultBranch ?? same?.defaultBranch;
  if (!defaultBranch) {
    const probe = await probeRepository(
      repoUrl,
      credential ? { username: credential.username, password: credential.secret } : undefined,
      outbound(),
    );
    if (!probe.ok) return c.json({ error: probe.code, message: probe.message }, 422);
    defaultBranch = probe.defaultBranch;
  }

  if (same) {
    if (!same.defaultBranch) {
      await db(c.env)
        .update(schema.projects)
        .set({ defaultBranch })
        .where(and(eq(schema.projects.id, same.id), isNull(schema.projects.defaultBranch)))
        .run();
    }
    const added = await addCloudLocation(c.env, userId, same.id, { credential });
    if (added !== true) {
      if (added.error === "no_repository") return c.json(added, 422);
      return failed(c, added);
    }
    // Checked a moment ago, by `pickedRepository`, as the person themselves.
    if (picked) await linkProjectStatement(c.env, userId, same.id, picked).run();
    // The clients named are given the project here too: that it already
    // existed is nothing the person who asked for it on Cloud had to know.
    await grantNewProject(c.env, { userId, projectId: same.id, clientIds: body.clientIds });
    return c.json({ projectId: same.id, deviceId: null, status: "ready", location: "joined" });
  }

  const result = await createCloudProject(c.env, userId, {
    name,
    slug: body.slug ?? projectSlug(name),
    repoUrl,
    defaultBranch,
    credential,
    github: picked ?? undefined,
  });
  if ("error" in result) return failed(c, result);
  await grantNewProject(c.env, {
    userId,
    projectId: result.projectId,
    clientIds: body.clientIds,
  });
  return c.json({ ...result, status: "creating", location: "created" }, 202);
});

cloud.post("/api/cloud/projects/:id/workspaces", zValidator("json", workspaceInput), async (c) => {
  const body = c.req.valid("json");
  const result = await createCloudWorkspace(c.env, c.get("userId"), c.req.param("id"), body);
  if ("error" in result) return failed(c, result);
  return c.json({ ...result, status: "creating" }, 202);
});

cloud.delete("/api/cloud/projects/:id", async (c) => {
  const ok = await destroyCloudProject(c.env, c.get("userId"), c.req.param("id"));
  return ok ? c.json({ ok: true }, 202) : c.json({ error: "not_found" }, 404);
});

cloud.delete("/api/cloud/projects/:id/workspaces/:wid", async (c) => {
  const ok = await destroyCloudWorkspace(
    c.env,
    c.get("userId"),
    c.req.param("id"),
    c.req.param("wid"),
  );
  return ok ? c.json({ ok: true }, 202) : c.json({ error: "not_found" }, 404);
});

cloud.post("/api/cloud/machines/:deviceId/retry", async (c) => {
  const result = await retryCloudMachine(c.env, c.get("userId"), c.req.param("deviceId"));
  if (result !== true) return failed(c, result);
  return c.json({ ok: true, status: "creating" }, 202);
});

cloud.put("/api/cloud/projects/:id/credential", zValidator("json", credentialInput), async (c) => {
  const body = c.req.valid("json");
  const result = await setCloudCredential(
    c.env,
    c.get("userId"),
    c.req.param("id"),
    body.token ? { username: body.username ?? "x-access-token", secret: body.token } : null,
  );
  if (result !== true) return failed(c, result);
  // Machines that already exist keep the credential they were set up with;
  // this one reaches the next machine created and any retried one.
  return c.json({ ok: true, appliesTo: "new_machines" });
});

function failed(
  c: { json: (body: unknown, status: 403 | 404 | 409 | 422 | 503) => Response },
  error: ProvisionError,
) {
  switch (error.error) {
    case "cloud_disabled":
      return c.json({ error: "cloud_disabled" }, 403);
    case "cli_unsupported":
      return c.json({ error: "cli_unsupported", message: error.message }, 503);
    case "plan_limit":
      return c.json(error, 403);
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "slug_conflict":
    case "not_retryable":
      return c.json({ error: error.error }, 409);
    case "credentials_unavailable":
      return c.json(
        {
          error: "credentials_unavailable",
          message:
            "This gateway cannot use the repository token: it has no key for tokens, or the stored one was encrypted under a key it no longer has. Set the token again.",
        },
        422,
      );
    case "invalid_branch":
      return c.json({ error: "invalid_branch", message: error.message }, 422);
    case "invalid_repo_url":
      return c.json({ error: "invalid_repo_url", message: error.message }, 422);
  }
}

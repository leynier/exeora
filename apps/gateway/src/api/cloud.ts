import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
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
import { listCloudProjects } from "../cloud/views.js";
import "../env.js";
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

const projectInput = z.object({
  name: z.string().min(1).max(100),
  slug,
  repoUrl: z
    .string()
    .url()
    .max(1000)
    .refine(
      validRepoUrl,
      "Use an https:// URL with the token in the token field, not in the address.",
    ),
  defaultBranch: z.string().min(1).max(255).default("main"),
  token: z.string().min(1).max(500).optional(),
  username: z.string().min(1).max(200).optional(),
});

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
  const result = await createCloudProject(c.env, c.get("userId"), {
    name: body.name,
    slug: body.slug,
    repoUrl: body.repoUrl,
    defaultBranch: body.defaultBranch,
    credential: body.token
      ? { username: body.username ?? "x-access-token", secret: body.token }
      : undefined,
  });
  if ("error" in result) return failed(c, result);
  return c.json({ ...result, status: "creating" }, 202);
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

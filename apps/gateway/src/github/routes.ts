import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../api/router.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { hasScope, insufficientScope } from "../oauth/scopes.js";
import { propsOf } from "../props.js";
import { GitHubError, GitHubReconnectError, githubConfig } from "./app.js";
import { projectCredential } from "./credentials.js";
import { connectUrl, disconnect, listInstallations } from "./installations.js";
import { outbound } from "./outbound.js";
import { listRepositories } from "./repositories.js";
import { signConnectState } from "./state.js";
import { hasUserToken } from "./user-token.js";

/**
 * GitHub for an account: whether it is connected, the repositories it can
 * pick from, and the credential a machine clones one of its projects with.
 *
 * The callback and the webhook are not here. GitHub calls those without an
 * access token, so they are served from `public.ts`, outside the API.
 */

export const github = new Hono<ApiEnv>();

const disabled = (c: { json: (body: unknown, status: 404) => Response }) =>
  c.json({ error: "github_disabled" }, 404);

/**
 * Where GitHub's answer is the problem, in words for the person. An
 * authorization that is gone is told apart from a GitHub that did not
 * answer: the first is mended by connecting again, the second by waiting.
 */
export function githubFailure(
  c: { json: (body: unknown, status: 409 | 502) => Response },
  error: GitHubError,
) {
  if (error instanceof GitHubReconnectError) {
    return c.json({ error: "github_reconnect", message: error.message }, 409);
  }
  return c.json({ error: "github_unavailable", message: error.message }, 502);
}

/**
 * The address to send the person to. It is GitHub's own, with the state
 * already in it: the dashboard calls this API with a bearer token, which a
 * plain link to a route here would not carry.
 */
async function connectAddress(env: Env, userId: string): Promise<string> {
  return connectUrl(env, await signConnectState(env, userId));
}

github.get("/api/github", async (c) => {
  if (!githubConfig(c.env)) {
    return c.json({
      enabled: false,
      connected: false,
      reconnect: false,
      installations: [],
      connectUrl: null,
    });
  }
  const userId = c.get("userId");
  const installations = await listInstallations(c.env, userId);
  // Installations without the person's token reach nothing: what they may
  // see is asked of GitHub as them. Connecting again is what brings it back.
  const authorized = await hasUserToken(c.env, userId);
  return c.json({
    enabled: true,
    connected: installations.length > 0 && authorized,
    reconnect: installations.length > 0 && !authorized,
    installations,
    // Good for ten minutes, so it is asked for when the person is about to
    // leave rather than kept from an earlier visit.
    connectUrl: await connectAddress(c.env, userId),
  });
});

github.get("/api/github/connect", async (c) => {
  if (!githubConfig(c.env)) return disabled(c);
  return c.redirect(await connectAddress(c.env, c.get("userId")), 302);
});

github.get("/api/github/repositories", async (c) => {
  if (!githubConfig(c.env)) {
    return c.json({ enabled: false, connected: false, repositories: [] });
  }
  const userId = c.get("userId");
  const installations = await listInstallations(c.env, userId);
  if (installations.length === 0) {
    return c.json({ enabled: true, connected: false, repositories: [] });
  }
  const limit = Number(c.req.query("limit"));
  try {
    const repositories = await listRepositories(
      c.env,
      userId,
      { query: c.req.query("q"), limit: Number.isFinite(limit) ? limit : undefined },
      outbound(),
    );
    return c.json({ enabled: true, connected: true, repositories });
  } catch (error) {
    if (error instanceof GitHubError) return githubFailure(c, error);
    throw error;
  }
});

github.delete("/api/github/installations/:id", async (c) => {
  if (!githubConfig(c.env)) return disabled(c);
  const removed = await disconnect(c.env, c.get("userId"), c.req.param("id"));
  if (!removed) return c.json({ error: "not_found" }, 404);
  // The app is still installed on GitHub, and this is where it is removed.
  return c.json({ ok: true, manageUrl: removed.manageUrl });
});

const credentialInput = z.object({ deviceId: z.string().min(1).max(200).optional() });

/**
 * What `exeora git-credential` asks on git's behalf.
 *
 * A token that can push is worth more than anything else this API hands out,
 * so it is given to the two callers that clone and to nobody else: a cloud
 * machine, for the one project it was made for, and the person's own CLI,
 * for a project that is theirs. The dashboard has no use for one, and a
 * token that never reaches a browser cannot be taken from one.
 */
github.post("/api/projects/:id/git-credential", async (c) => {
  if (!githubConfig(c.env)) return disabled(c);
  const props = propsOf(c.executionCtx);
  if (!hasScope(props, "executor:connect")) return insufficientScope(["executor:connect"]);

  const userId = c.get("userId");
  const projectId = c.req.param("id");

  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
  }
  const body = credentialInput.safeParse(raw);
  if (!body.success) return c.json({ error: "invalid_body" }, 400);

  if (props.deviceId !== undefined) {
    // A machine token carries its owner's user id, which would pass every
    // check below for any of their projects. The machine is what is checked.
    const machine = await db(c.env)
      .select({ deviceId: schema.cloudMachines.deviceId })
      .from(schema.cloudMachines)
      .where(
        and(
          eq(schema.cloudMachines.deviceId, props.deviceId),
          eq(schema.cloudMachines.projectId, projectId),
          eq(schema.cloudMachines.userId, userId),
        ),
      )
      .get();
    if (!machine) return c.json({ error: "forbidden" }, 403);
  } else {
    const project = await db(c.env)
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
      .get();
    if (!project) return c.json({ error: "not_found" }, 404);

    if (body.data.deviceId !== undefined) {
      const device = await db(c.env)
        .select({ kind: schema.devices.kind, revokedAt: schema.devices.revokedAt })
        .from(schema.devices)
        .where(and(eq(schema.devices.id, body.data.deviceId), eq(schema.devices.userId, userId)))
        .get();
      if (!device) return c.json({ error: "unknown_device" }, 400);
      if (device.revokedAt) return c.json({ error: "device_revoked" }, 409);
      // A cloud machine asks with its own token, never by being named.
      if (device.kind === "cloud") return c.json({ error: "cloud_device" }, 400);
    }
  }

  try {
    const credential = await projectCredential(c.env, userId, projectId, outbound());
    if (!credential) return c.json({ error: "no_credential" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json(credential);
  } catch (error) {
    if (error instanceof GitHubError) return githubFailure(c, error);
    throw error;
  }
});

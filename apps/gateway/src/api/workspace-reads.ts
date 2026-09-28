import { WorkspaceReadAction } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ApiEnv } from "./router.js";
import { dispatch, ownedTarget, targetQuery, workspaceError } from "./workspace-target.js";

/**
 * The reads of a checkout: history, patches, the tree, a file, a search.
 * One route for all of them, as `GET …/workspace/status` and `…/diff` are
 * for the two that came first. Not audited and not counted as a write: a
 * search as one types is the same kind of traffic as the status poll.
 */
export const workspaceReads = new Hono<ApiEnv>();

workspaceReads.post(
  "/api/projects/:id/workspace/reads",
  zValidator("query", targetQuery),
  zValidator("json", WorkspaceReadAction),
  async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("id");
    const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").workspace);
    if (!target) return c.json({ error: "not_found" }, 404);
    try {
      const value = await dispatch(
        c.env,
        userId,
        projectId,
        target,
        c.req.valid("json"),
        c.req.raw.signal,
      );
      return c.json(value);
    } catch (error) {
      return workspaceError(c, error);
    }
  },
);

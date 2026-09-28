import { ExeoraError } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../../api/router.js";
import {
  dispatch,
  ownedTarget,
  type ResolvedTarget,
  workspaceError,
} from "../../api/workspace-target.js";
import { beginAudit, finishAudit } from "../../audit.js";
import "../../env.js";
import { uiClientName } from "../../props.js";
import { GitHubError, GitHubReconnectError, githubConfig } from "../app.js";
import { outbound } from "../outbound.js";
import { githubFailure } from "../routes.js";
import { currentUserToken } from "../user-token.js";
import { MERGE_METHODS, type PullRequestApi, pullRequestApi } from "./api.js";
import { groupChecks } from "./checks.js";
import { commentItem, conversation, reviewCommentItem } from "./conversation.js";
import { installationFor, type RepositoryName, repositoryOf } from "./repo.js";

/**
 * The pull request of a branch, from the dashboard.
 *
 * Everything here is asked of GitHub as the person, with the token they
 * connected with: what they may see and do there is what they may see and
 * do here. Reads are not audited; each change is, under
 * `pull_request.<what>`, without the title or body it carried.
 */

export const pullRequests = new Hono<ApiEnv>();

const targetQuery = z.object({ workspace: z.string().min(1).max(128).optional() });
const lookupQuery = targetQuery.extend({ branch: z.string().min(1).max(255).optional() });
const numbered = z.object({ id: z.string().min(1), number: z.coerce.number().int().positive() });
const commentParam = numbered.extend({ commentId: z.coerce.number().int().positive() });
const commentBody = z.string().min(1).max(65_536);

const createInput = z.object({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536).default(""),
  base: z.string().min(1).max(255),
  head: z.string().min(1).max(255),
  draft: z.boolean().default(false),
  /** Push the head branch first, so the pull request is made of what the machine has. */
  push: z.boolean().default(true),
});
const updateInput = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  base: z.string().min(1).max(255).optional(),
  draft: z.boolean().optional(),
});
const mergeInput = z.object({ method: z.enum(MERGE_METHODS) });
const commentInput = z.object({ body: commentBody });
const commentEditInput = z.object({
  body: commentBody,
  kind: z.enum(["comment", "review_comment"]),
});

type Ctx = Context<ApiEnv>;

interface Prepared {
  ok: true;
  userId: string;
  projectId: string;
  target: ResolvedTarget;
  name: RepositoryName;
  api: PullRequestApi;
}

interface Refused {
  ok: false;
  reason: "github_disabled" | "not_found" | "not_github";
  response: Response;
}

/**
 * What every route needs before it asks GitHub anything: the app switched
 * on, the project the caller's, and the repository it is on GitHub. Comes
 * with the response to send when one of those is missing.
 */
async function prepared(c: Ctx, selector?: string): Promise<Prepared | Refused> {
  const refused = (reason: Refused["reason"], message?: string): Refused => ({
    ok: false,
    reason,
    response: c.json({ error: reason, ...(message ? { message } : {}) }, 404),
  });
  if (!githubConfig(c.env)) return refused("github_disabled");
  const userId = c.get("userId");
  const projectId = c.req.param("id") ?? "";
  const target = await ownedTarget(c.env, userId, projectId, selector);
  if (!target) return refused("not_found");
  const name = await repositoryOf(c.env, userId, projectId);
  if (!name) return refused("not_github", "This project's remote is not a GitHub repository.");
  const api = pullRequestApi(c.env, userId, name, outbound());
  return { ok: true, userId, projectId, target, name, api };
}

/** Runs a route body, answering for GitHub when GitHub is what failed. */
async function answering(c: Ctx, body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof GitHubError) return githubFailure(c, error);
    throw error;
  }
}

function auditCode(error: unknown): string {
  if (error instanceof GitHubReconnectError) return "GITHUB_RECONNECT";
  if (error instanceof GitHubError) return "GITHUB_UNAVAILABLE";
  if (error instanceof ExeoraError) return error.code;
  return "INTERNAL_ERROR";
}

/** One audited change. Its argument is never written: a title is the person's, not the log's. */
async function audited<T>(c: Ctx, p: Prepared, tool: string, work: () => Promise<T>): Promise<T> {
  const audit = await beginAudit(c.env, {
    userId: p.userId,
    projectId: p.projectId,
    ...(p.target.workspaceId ? { workspaceId: p.target.workspaceId } : {}),
    workspaceSlug: p.target.recordedAs,
    tool,
    endpoint: "dashboard",
    caller: { clientId: undefined, clientName: uiClientName(c.executionCtx), mcp: undefined },
  });
  try {
    const value = await work();
    await finishAudit(c.env, audit, { status: "ok" });
    return value;
  } catch (error) {
    await finishAudit(c.env, audit, { status: "error", errorCode: auditCode(error) });
    throw error;
  }
}

pullRequests.get("/api/projects/:id/pull-request", zValidator("query", lookupQuery), async (c) => {
  const { workspace, branch } = c.req.valid("query");
  const p = await prepared(c, workspace);
  if (!p.ok) {
    // A project that is not on GitHub is an answer for this screen, not a refusal.
    if (p.reason !== "not_github") return p.response;
    return c.json({ repository: null, pullRequest: null, pending: [], reason: "not_github" });
  }
  return answering(c, async () => {
    const [installation, repository, number] = await Promise.all([
      installationFor(c.env, p.userId, p.name.owner),
      p.api.repositoryInfo(),
      branch === undefined ? null : p.api.findPullRequestByHead(branch),
    ]);
    const pullRequest = number === null ? null : await p.api.getPullRequest(number);
    return c.json({ repository, pullRequest, pending: installation?.pending ?? [] });
  });
});

pullRequests.get(
  "/api/projects/:id/pull-request/:number/checks",
  zValidator("param", numbered),
  async (c) => {
    const { number } = c.req.valid("param");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const pullRequest = await p.api.getPullRequest(number);
      const { runs, statuses } = await p.api.listChecks(pullRequest.head.sha);
      return c.json({ sha: pullRequest.head.sha, ...groupChecks(runs, statuses) });
    });
  },
);

pullRequests.get(
  "/api/projects/:id/pull-request/:number/conversation",
  zValidator("param", numbered),
  async (c) => {
    const { number } = c.req.valid("param");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const [viewer, comments, reviewComments, reviews] = await Promise.all([
        currentUserToken(c.env, p.userId, outbound()).then((token) => token.login),
        p.api.listIssueComments(number),
        p.api.listReviewComments(number),
        p.api.listReviews(number),
      ]);
      const items = conversation({ comments, reviewComments, reviews }, viewer);
      return c.json({ items, viewer });
    });
  },
);

pullRequests.post(
  "/api/projects/:id/pull-request",
  zValidator("query", targetQuery),
  zValidator("json", createInput),
  async (c) => {
    const input = c.req.valid("json");
    const p = await prepared(c, c.req.valid("query").workspace);
    if (!p.ok) return p.response;
    if (input.push) {
      // The branch as the machine has it, before GitHub is asked to open it.
      // A push that fails answers as a workspace error, and nothing is created.
      try {
        await audited(c, p, "source_control.push", () =>
          dispatch(
            c.env,
            p.userId,
            p.projectId,
            p.target,
            { action: "push", remote: "origin", setUpstream: true },
            c.req.raw.signal,
          ),
        );
      } catch (error) {
        return workspaceError(c, error);
      }
    }
    return answering(c, async () => {
      const { push: _push, ...request } = input;
      const pullRequest = await audited(c, p, "pull_request.create", () =>
        p.api.createPullRequest(request),
      );
      return c.json({ pullRequest }, 201);
    });
  },
);

pullRequests.patch(
  "/api/projects/:id/pull-request/:number",
  zValidator("param", numbered),
  zValidator("json", updateInput),
  async (c) => {
    const { number } = c.req.valid("param");
    const { title, base, draft } = c.req.valid("json");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const pullRequest = await audited(c, p, "pull_request.update", async () => {
        let current = await p.api.getPullRequest(number);
        if (title !== undefined || base !== undefined) {
          current = await p.api.updatePullRequest(number, {
            ...(title === undefined ? {} : { title }),
            ...(base === undefined ? {} : { base }),
          });
        }
        const open = current.state === "open" || current.state === "draft";
        if (draft !== undefined && open && (current.state === "draft") !== draft) {
          await p.api.setDraft(current.nodeId, draft);
          current = await p.api.getPullRequest(number);
        }
        return current;
      });
      return c.json({ pullRequest });
    });
  },
);

pullRequests.post(
  "/api/projects/:id/pull-request/:number/merge",
  zValidator("param", numbered),
  zValidator("json", mergeInput),
  async (c) => {
    const { number } = c.req.valid("param");
    const { method } = c.req.valid("json");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const repository = await p.api.repositoryInfo();
      if (!repository.mergeMethods.includes(method)) {
        return c.json(
          {
            error: "merge_method_not_allowed",
            message: `The repository does not allow ${method} merges.`,
            allowed: repository.mergeMethods,
          },
          422,
        );
      }
      const outcome = await audited(c, p, "pull_request.merge", () =>
        p.api.mergePullRequest(number, method),
      );
      return c.json(outcome);
    });
  },
);

pullRequests.post(
  "/api/projects/:id/pull-request/:number/close",
  zValidator("param", numbered),
  async (c) => {
    const { number } = c.req.valid("param");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const pullRequest = await audited(c, p, "pull_request.close", () =>
        p.api.closePullRequest(number),
      );
      return c.json({ pullRequest });
    });
  },
);

pullRequests.post(
  "/api/projects/:id/pull-request/:number/comments",
  zValidator("param", numbered),
  zValidator("json", commentInput),
  async (c) => {
    const { number } = c.req.valid("param");
    const { body } = c.req.valid("json");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const created = await audited(c, p, "pull_request.comment", () =>
        p.api.createIssueComment(number, body),
      );
      // Written by the person asking, so it is theirs to edit.
      return c.json({ item: commentItem(created, created.author.login) }, 201);
    });
  },
);

pullRequests.patch(
  "/api/projects/:id/pull-request/:number/comments/:commentId",
  zValidator("param", commentParam),
  zValidator("json", commentEditInput),
  async (c) => {
    const { commentId } = c.req.valid("param");
    const { body, kind } = c.req.valid("json");
    const p = await prepared(c);
    if (!p.ok) return p.response;
    return answering(c, async () => {
      const item = await audited(c, p, "pull_request.comment_edit", async () =>
        kind === "comment"
          ? commentItem(await p.api.updateIssueComment(commentId, body), null)
          : reviewCommentItem(await p.api.updateReviewComment(commentId, body), null),
      );
      return c.json({ item: { ...item, editable: true } });
    });
  },
);

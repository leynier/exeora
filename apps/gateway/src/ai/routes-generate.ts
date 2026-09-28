import {
  ExeoraError,
  GitRangeContext,
  GitStagedContext,
  type WorkspaceAction,
  type WorkspaceValue,
} from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../api/router.js";
import { dispatch, ownedTarget, targetQuery, workspaceError } from "../api/workspace-target.js";
import { beginAudit, finishAudit } from "../audit.js";
import { AI_PROVIDER_IDS, type AiOperation, type AiProviderId } from "../db/schema-ai.js";
import "../env.js";
import { uiClientName } from "../props.js";
import { defaultModel } from "./catalog.js";
import { cleanupCommitMessage, cleanupPullRequest } from "./cleanup.js";
import { current, linkedProviders } from "./credentials.js";
import { outbound } from "./outbound.js";
import { commitPrompt, type Prompt, pullRequestPrompt } from "./prompts.js";
import { GENERATE_TIMEOUT_MS, withTimeout } from "./providers/http.js";
import { aiConfig, offeredProvider } from "./providers/index.js";
import { AiError } from "./providers/types.js";
import { aiFailure } from "./routes.js";
import { readSettings } from "./settings.js";

/**
 * Generations for a project: a commit message from what is staged, a pull
 * request from what a branch adds over its base. The context is read from
 * the machine, sent to the provider and kept nowhere; the audit trail
 * records that it happened, and never what was sent or answered.
 */

export const aiGenerate = new Hono<ApiEnv>();

const provider = z.enum(AI_PROVIDER_IDS).optional();
const commitInput = z.object({ provider });
const pullRequestInput = z.object({ provider, base: z.string().trim().min(1).max(512) });

/** What one operation needs beyond the shared flow. */
interface Generation {
  operation: AiOperation;
  tool: string;
  action: WorkspaceAction;
  /** The prompt for the context, or the sentence for a context with nothing in it. */
  prepare: (value: WorkspaceValue, instructions: string | null) => Prompt | { empty: string };
  finish: (text: string) => Record<string, unknown>;
}

aiGenerate.post(
  "/api/projects/:id/ai/commit-message",
  zValidator("query", targetQuery),
  zValidator("json", commitInput),
  async (c) =>
    generate(c, c.req.valid("json").provider, c.req.valid("query").workspace, {
      operation: "commit",
      tool: "ai.commit_message",
      action: { action: "staged_context" },
      prepare: (value, instructions) => {
        const context = GitStagedContext.safeParse(value);
        if (!context.success) throw unexpected();
        if (context.data.files.length === 0 && context.data.patch.trim() === "") {
          return { empty: "Nothing is staged. Stage the changes to describe first." };
        }
        return commitPrompt(context.data, instructions);
      },
      finish: (text) => ({ message: cleanupCommitMessage(text) }),
    }),
);

aiGenerate.post(
  "/api/projects/:id/ai/pull-request",
  zValidator("query", targetQuery),
  zValidator("json", pullRequestInput),
  async (c) => {
    const { base } = c.req.valid("json");
    return generate(c, c.req.valid("json").provider, c.req.valid("query").workspace, {
      operation: "pull_request",
      tool: "ai.pull_request",
      action: { action: "range_context", base },
      prepare: (value, instructions) => {
        const context = GitRangeContext.safeParse(value);
        if (!context.success) throw unexpected();
        if (context.data.commits.length === 0 && context.data.patch.trim() === "") {
          return { empty: `There are no commits or changes over ${base} to describe.` };
        }
        return pullRequestPrompt(context.data, instructions);
      },
      finish: (text) => cleanupPullRequest(text),
    });
  },
);

async function generate(
  c: Context<ApiEnv>,
  chosen: AiProviderId | undefined,
  selector: string | undefined,
  generation: Generation,
) {
  const config = aiConfig(c.env);
  if (!config) return c.json({ error: "ai_disabled" }, 404);
  const userId = c.get("userId");
  const projectId = c.req.param("id") ?? "";
  const target = await ownedTarget(c.env, userId, projectId, selector);
  if (!target) return c.json({ error: "not_found" }, 404);

  // The provider: the one asked for, else the operation's, else the
  // account's default, else the one provider the account linked.
  const settings = await readSettings(c.env, userId);
  const operation = settings.operations[generation.operation];
  const providerId =
    chosen ??
    operation.provider ??
    settings.defaultProvider ??
    (await linkedProviders(c.env, userId))[0]?.provider;
  const offered = providerId ? offeredProvider(config, providerId) : null;
  if (!offered) {
    return c.json(
      { error: "ai_not_linked", message: "Link ChatGPT or Grok in the settings first." },
      409,
    );
  }
  const fetcher = outbound();
  let credential: Awaited<ReturnType<typeof current>>;
  try {
    credential = await current(c.env, config, userId, offered.provider, fetcher);
  } catch (error) {
    if (error instanceof AiError) return aiFailure(c, error);
    throw error;
  }
  const model = operation.model ?? defaultModel(offered.provider.id);

  const audit = await beginAudit(c.env, {
    userId,
    projectId,
    ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    workspaceSlug: target.recordedAs,
    tool: generation.tool,
    endpoint: "dashboard",
    caller: { clientId: undefined, clientName: uiClientName(c.executionCtx), mcp: undefined },
  });
  try {
    const value = await dispatch(
      c.env,
      userId,
      projectId,
      target,
      generation.action,
      c.req.raw.signal,
    );
    const prepared = generation.prepare(value, operation.instructions);
    if ("empty" in prepared) {
      await finishAudit(c.env, audit, { status: "error", errorCode: "NOTHING_TO_SUMMARIZE" });
      return c.json({ error: "ai_nothing_to_summarize", message: prepared.empty }, 422);
    }
    const text = await offered.provider.generate(fetcher, credential, {
      model,
      system: prepared.system,
      user: prepared.user,
      signal: withTimeout(GENERATE_TIMEOUT_MS, c.req.raw.signal),
    });
    await finishAudit(c.env, audit, { status: "ok" });
    return c.json({ ...generation.finish(text), provider: offered.provider.id, model });
  } catch (error) {
    await finishAudit(c.env, audit, { status: "error", errorCode: codeOf(error) });
    if (error instanceof AiError) return aiFailure(c, error);
    if (error instanceof ExeoraError) return workspaceError(c, error);
    if (c.req.raw.signal.aborted) return c.json({ error: "CANCELLED" }, 499 as never);
    console.error("ai generation failed", error);
    return c.json({ error: "INTERNAL_ERROR", message: "Generation failed." }, 500);
  }
}

function unexpected(): AiError {
  return new AiError("unavailable", "The machine answered with something unexpected. Try again.");
}

function codeOf(error: unknown): string {
  if (error instanceof ExeoraError) return error.code;
  if (error instanceof AiError) return `AI_${error.kind.toUpperCase()}`;
  return "INTERNAL_ERROR";
}

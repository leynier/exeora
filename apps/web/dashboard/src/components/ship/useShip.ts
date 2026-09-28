import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { errorText, type GitStatus } from "../../api.js";
import { aiApi } from "../../api-ai.js";
import { type PullRequest, prApi } from "../../api-pr.js";
import { keys } from "../../queries.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { branchFromSubject, type ShipStep, type ShipStepState, shipPlan } from "./shipPlan.js";

export type ShipProgress = {
  steps: { step: ShipStep; state: ShipStepState; note?: string }[];
  running: boolean;
  error: string | null;
  pullRequest: PullRequest | null;
};

const IDLE: ShipProgress = { steps: [], running: false, error: null, pullRequest: null };

/**
 * Everything between a working tree and a pull request, in one go.
 *
 * Stages what changed, has the assistant write the commit message, makes a
 * branch when HEAD is the base, commits, has the assistant write the pull
 * request, pushes with an upstream, and opens it. Each step shows as it
 * runs; the first failure stops the chain where it is, with the checkout in
 * whatever state that step reached, which is said in the error.
 */
export function useShip(ctx: WorkspaceContext) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<ShipProgress>(IDLE);
  const abort = useRef<AbortController | null>(null);

  const mark = useCallback(
    (step: ShipStep, state: ShipStepState, note?: string) =>
      setProgress((current) => ({
        ...current,
        steps: current.steps.map((item) =>
          item.step === step ? { ...item, state, ...(note ? { note } : {}) } : item,
        ),
      })),
    [],
  );

  const run = useCallback(
    async (base: string) => {
      const status = ctx.status.data;
      // A ship that is running owns the checkout until it is done or stopped.
      if (!status || abort.current) return;
      const plan = shipPlan(status, base);
      const controller = new AbortController();
      abort.current = controller;
      setProgress({
        steps: plan.steps.map((step) => ({ step, state: "pending" })),
        running: true,
        error: null,
        pullRequest: null,
      });
      const { projectId, workspace } = ctx.target;
      let current: GitStatus = status;
      let subject = "";
      try {
        const step = async <T>(name: ShipStep, work: () => Promise<T>): Promise<T> => {
          if (controller.signal.aborted) throw new Error("Stopped.");
          mark(name, "running");
          const value = await work();
          mark(name, "done");
          return value;
        };
        const mutate = async (action: Parameters<typeof ctx.actions.run>[0]) => {
          const result = await ctx.actions.run(action, { quiet: true });
          if (!result) throw new Error("The action failed; see the message above.");
          if (result.kind === "mutation") current = result.status;
          return result;
        };
        if (plan.steps.includes("stage")) {
          await step("stage", async () => {
            const paths = current.files
              .filter((file) => file.worktree !== "." || file.kind === "untracked")
              .map((file) => file.path);
            for (let at = 0; at < paths.length; at += 1000) {
              await mutate({ action: "stage", paths: paths.slice(at, at + 1000) });
            }
          });
        }
        let message = "";
        if (plan.steps.includes("commit_message")) {
          message = await step("commit_message", async () => {
            const result = await aiApi.commitMessage(
              projectId,
              undefined,
              workspace,
              controller.signal,
            );
            subject = result.message.split("\n")[0] ?? "";
            mark("commit_message", "running", subject);
            return result.message;
          });
        }
        if (plan.steps.includes("branch")) {
          await step("branch", async () => {
            const taken = current.branches.map((branch) => branch.name);
            const name = branchFromSubject(subject || "changes", taken);
            mark("branch", "running", name);
            await mutate({ action: "branch_create", name });
          });
        }
        if (plan.steps.includes("commit")) {
          await step("commit", () => mutate({ action: "commit", message }));
        }
        const text = await step("pr_text", async () => {
          const result = await aiApi.pullRequest(
            projectId,
            undefined,
            base,
            workspace,
            controller.signal,
          );
          mark("pr_text", "running", result.title);
          return result;
        });
        const head = current.head;
        if (!head) throw new Error("The checkout is not on a branch.");
        await step("push", async () => {
          const remote = current.remotes[0];
          await mutate(
            current.upstream || !remote
              ? { action: "push" }
              : { action: "push", remote, setUpstream: true },
          );
        });
        const opened = await step("pull_request", async () => {
          const result = await prApi.create(projectId, workspace, {
            title: text.title,
            body: text.body,
            base,
            head,
            push: false,
          });
          return result.pullRequest;
        });
        setProgress((state) => ({ ...state, running: false, pullRequest: opened }));
        void client.invalidateQueries({ queryKey: ["pull-request", projectId] });
        void client.invalidateQueries({
          queryKey: keys.gitStatus(projectId, ctx.target.targetKey),
        });
      } catch (error) {
        setProgress((state) => ({
          ...state,
          running: false,
          error: errorText(error, "Shipping stopped."),
          steps: state.steps.map((item) =>
            item.state === "running" ? { ...item, state: "failed" } : item,
          ),
        }));
      } finally {
        abort.current = null;
      }
    },
    [client, ctx, mark],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => setProgress(IDLE), []);

  return { progress, run, stop, reset };
}

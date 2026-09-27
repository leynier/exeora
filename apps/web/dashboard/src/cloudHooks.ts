import { ApiError, errorText, relativeTime } from "./api.js";
import type { CloudInstance, HookRun, ToolsReport } from "./api-projects.js";
import type { CloudHook } from "./api-types.js";
import { HOOKS } from "./cloudScripts.js";

/**
 * What became of a project's scripts on one instance, and of the tools it
 * comes with, as sentences.
 *
 * A script that fails leaves the instance ready. So none of this is a
 * failure of the instance, and none of it is said in the words a failed
 * instance uses: it is a warning beside something that works.
 */

/** Whether a run ended badly, which is the only end that needs somebody. */
export function isTroubled(run: HookRun | null | undefined): boolean {
  return run?.status === "failed" || run?.status === "timed_out";
}

/** A length of time in the words a sentence takes: `45 seconds`, `2 minutes`. */
export function spent(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 1) return "less than a second";
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function took(run: HookRun): string | null {
  return run.finishedAt === null ? null : spent(run.finishedAt - run.startedAt);
}

/** How a run that ended badly ended: "The install script failed (exit 3)." */
export function hookSentence(hook: CloudHook, run: HookRun): string {
  if (run.status === "timed_out") {
    const after = took(run);
    return `The ${hook} script ran out of time${after ? ` after ${after}` : ""}.`;
  }
  return `The ${hook} script failed${run.exitCode === null ? "" : ` (exit ${run.exitCode})`}.`;
}

/** Where the script that ran was written, or null when there was none. */
export function hookSource(run: Pick<HookRun, "source">): string | null {
  if (run.source === "dashboard") return "from the project's page";
  if (run.source === "repository") return "from the repository";
  return null;
}

export function runningSentence(hook: CloudHook): string {
  return `Running the ${hook} script…`;
}

/** Everything the row says about a run that ended badly, in one paragraph. */
export function hookWarning(hook: CloudHook, run: HookRun): string {
  const source = hookSource(run);
  return [
    hookSentence(hook, run),
    source ? `It came ${source}.` : null,
    "Fix the script, then run it again.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A run as one line of reference: its state, where the script came from, when
 * and for how long. `skipped` is said as what it means, which is no script.
 */
export function hookFact(run: HookRun | null): string {
  if (run === null) return "not run yet";
  if (run.status === "skipped") return "no script";
  const source = hookSource(run);
  if (run.status === "running") {
    return ["running", source, `started ${relativeTime(run.startedAt)}`]
      .filter(Boolean)
      .join(" · ");
  }
  const state =
    run.status === "timed_out"
      ? "ran out of time"
      : run.status === "failed"
        ? `failed${run.exitCode === null ? "" : ` (exit ${run.exitCode})`}`
        : "ok";
  const after = took(run);
  return [
    state,
    source,
    relativeTime(run.finishedAt ?? run.startedAt),
    after ? `took ${after}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A script of an instance that has something to say on the row. */
export interface NoticedHook {
  hook: CloudHook;
  run: HookRun;
}

/** States in which an instance is not there to run anything, or says so itself. */
const NOT_READY = new Set<string>(["setting up", "failed", "removing", "removed"]);

/**
 * The scripts the row speaks of: the ones that ended badly, and the ones
 * running right now.
 *
 * Nothing while the instance is being set up, where the step beside its state
 * already says the script is running, and nothing for one that failed or is
 * on its way out, which has worse to say.
 */
export function noticedHooks(instance: Pick<CloudInstance, "state" | "hooks">): NoticedHook[] {
  if (NOT_READY.has(instance.state) || !instance.hooks?.supported) return [];
  const noticed: NoticedHook[] = [];
  for (const hook of HOOKS) {
    const run = instance.hooks[hook];
    if (run && (isTroubled(run) || run.status === "running")) noticed.push({ hook, run });
  }
  return noticed;
}

/** The scripts of an instance that ended badly, for the page that lists what needs somebody. */
export function troubledHooks(instance: Pick<CloudInstance, "state" | "hooks">): NoticedHook[] {
  return noticedHooks(instance).filter((entry) => isTroubled(entry.run));
}

/**
 * The tools that could not be installed, as one calm line, or null when every
 * one of them is there. A required tool is left out: without it the instance
 * fails, and says so as the failure it is.
 */
export function toolsNote(tools: ToolsReport | null | undefined): string | null {
  const missing = (tools?.tools ?? [])
    .filter((tool) => tool.state === "failed" && !tool.required)
    .map((tool) => tool.name);
  if (missing.length === 0) return null;
  const count = missing.length === 1 ? "1 tool" : `${missing.length} tools`;
  return `${count} could not be installed: ${missing.join(", ")}. About this instance says why.`;
}

/** One group of tools, as a label and the names under it. */
export interface ToolsLine {
  label: string;
  text: string;
}

/**
 * The tools of an instance, grouped by what became of them. The ones that are
 * there are named and nothing more; the ones that are not carry the reason,
 * which is the only part anybody can act on.
 */
export function toolsLines(tools: ToolsReport): ToolsLine[] {
  const named = (state: ToolsReport["tools"][number]["state"], reasons: boolean) =>
    tools.tools
      .filter((tool) => tool.state === state)
      .map((tool) => (reasons && tool.reason ? `${tool.name} (${tool.reason})` : tool.name))
      .join(", ");
  return [
    { label: "Already there", text: named("present", false) },
    { label: "Installed", text: named("installed", false) },
    { label: "Failed", text: named("failed", true) },
    { label: "Skipped", text: named("skipped", true) },
  ].filter((line) => line.text.length > 0);
}

/** Why a script could not be asked to run again, as the cause and what to do. */
export function runRefusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "hooks_unsupported") {
      return "This instance was made before scripts existed. Destroy it and start it again to run them.";
    }
    if (error.code === "machine_waking") {
      return "The instance is waking up. Try again in a moment.";
    }
    if (error.code === "not_found") {
      return "This instance no longer exists. Reload the page to see what is running.";
    }
  }
  return errorText(error, "The script could not be run. Try again in a moment.");
}

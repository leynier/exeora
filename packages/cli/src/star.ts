import * as p from "@clack/prompts";
import { execa } from "execa";
import { config, type StarPrompt } from "./config.js";

/**
 * The one thing the CLI ever asks for in return.
 *
 * Exeora is open source and a star is the cheapest way anyone can help, but a
 * tool that begs is a tool people uninstall. So the question is rationed hard:
 * it needs the third interactive run, a real terminal, and a `gh` that is both
 * installed and signed in, and even then it is asked at most twice ever on a
 * machine. Everyone else never learns this file exists.
 *
 * `gh` is the whole mechanism rather than a fallback because it is the only way
 * to star a repository without asking anyone for a token or opening a browser:
 * someone who has it authenticated has already granted GitHub credentials to
 * their terminal, and the star is one request away.
 */

const REPO = "leynier/exeora";

/** Long enough to read the line, short enough not to hold a command hostage. */
const ANSWER_TIMEOUT_MS = 30_000;

/** No `gh` today. Try again in a while, rather than probing on every run. */
const RETRY_AFTER_RUNS = 10;

/** Told no once. Ask a second and final time much later, or never if declined. */
const RETRY_AFTER_DECLINE_RUNS = 30;

/** A `gh` that has to be waited on is a `gh` that is not going to answer. */
const GH_TIMEOUT_MS = 5_000;

/**
 * Records this run and says whether it may go on to look for `gh`.
 *
 * Pure, so the rationing can be tested without a terminal or a subprocess: the
 * caller owns persisting `next`, which it must do either way, including when
 * the answer is no.
 */
export function tick(state: StarPrompt): { next: StarPrompt; consider: boolean } {
  const next = { ...state, runs: state.runs + 1 };
  return { next, consider: !next.done && next.runs >= next.askAt };
}

/** `gh` is missing or signed out: nothing to ask with, so wait it out. */
export function afterUnavailable(state: StarPrompt): StarPrompt {
  return { ...state, askAt: state.runs + RETRY_AFTER_RUNS };
}

/**
 * Turned down.
 *
 * The first no buys a long silence, the second closes the subject for good.
 * Asking a third time would be asking someone who has already answered.
 */
export function afterDecline(state: StarPrompt): StarPrompt {
  const asked = state.asked + 1;
  return asked >= 2
    ? { ...state, asked, done: true }
    : { ...state, asked, askAt: state.runs + RETRY_AFTER_DECLINE_RUNS };
}

/**
 * Whether there is a person at this terminal who could be asked anything.
 *
 * The same test `connection.ts` makes before telling the gateway it can prompt,
 * for the same reason: under systemd, in a detached pane, or with either stream
 * redirected, a question is just noise in a log. `--json` is decided by the
 * caller, which owns the flag.
 */
export function interactive(json: boolean): boolean {
  return (
    !json &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI &&
    !process.env.EXEORA_NO_STAR_PROMPT
  );
}

/**
 * Counts this run and, on the rare one that qualifies, asks.
 *
 * Never throws and never rejects. A command must not fail, or even slow down
 * visibly, because of a favour it was asking on the side, so every failure path
 * here is a silent return.
 */
export async function maybeAskForStar(canAsk: boolean): Promise<void> {
  // Not a terminal: the run is not even counted. Someone who only ever drives
  // the CLI from scripts should still meet the question the first three times
  // they sit down in front of it.
  if (!canAsk) return;

  try {
    const { next, consider } = tick(config.get("star"));
    config.set("star", next);
    if (!consider) return;

    if (!(await ghReady())) {
      config.set("star", afterUnavailable(next));
      return;
    }

    // Someone who already starred it must never be asked. It also settles the
    // matter permanently, which is worth one request.
    if (await alreadyStarred()) {
      config.set("star", { ...next, done: true });
      return;
    }

    p.log.message("Exeora is free and open source. A star helps other people find it.");

    /**
     * Silence is a yes.
     *
     * The prompt defaults to yes and nobody answered, so the default stands.
     * Ctrl+C is different and means no: the signal has not fired, and someone
     * dismissing a question has answered it.
     */
    const signal = AbortSignal.timeout(ANSWER_TIMEOUT_MS);
    const answer = await p.confirm({
      message: `Star ${REPO} on GitHub?`,
      initialValue: true,
      signal,
    });
    const cancelled = p.isCancel(answer);
    const unanswered = cancelled && signal.aborted;
    const yes = cancelled ? unanswered : answer;

    if (!yes) {
      config.set("star", afterDecline(next));
      return;
    }

    // Whether or not the request lands, the subject is closed. A star that
    // failed on a token without the scope for it will not succeed next week,
    // and asking again over it would be the nagging this file exists to avoid.
    config.set("star", { ...next, asked: next.asked + 1, done: true });

    if (!(await star())) {
      p.log.info(`Could not star ${REPO} from here. Thank you for the thought.`);
      return;
    }

    p.log.success(
      unanswered
        ? `Starred ${REPO}. Thank you! (\`gh api --method DELETE user/starred/${REPO}\` undoes it.)`
        : `Starred ${REPO}. Thank you!`,
    );
  } catch {
    // Including a `conf` that cannot be written and a terminal that went away
    // mid-prompt. There is nothing here worth reporting to someone who asked
    // for something else entirely.
  }
}

/**
 * Whether `gh` is installed and signed in.
 *
 * `reject: false` turns a missing binary into a failed result rather than a
 * throw, so the two ways of not having `gh` are one branch. Nothing is piped to
 * the terminal, and stdin is closed so `gh` can never decide to prompt on top
 * of a CLI that is mid-command.
 */
async function ghReady(): Promise<boolean> {
  return await gh(["auth", "status"]);
}

/** 204 when it is starred, 404 when it is not, which `gh` maps to the exit code. */
async function alreadyStarred(): Promise<boolean> {
  return await gh(["api", `user/starred/${REPO}`]);
}

async function star(): Promise<boolean> {
  return await gh(["api", "--method", "PUT", `user/starred/${REPO}`]);
}

/** Ran and succeeded. Every other outcome, including no `gh` at all, is false. */
async function gh(args: string[]): Promise<boolean> {
  const result = await execa("gh", args, {
    reject: false,
    timeout: GH_TIMEOUT_MS,
    stdin: "ignore",
  });
  return result.failed === false;
}

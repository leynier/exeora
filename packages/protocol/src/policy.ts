import { z } from "zod";
import { TOOL_DEFINITIONS, type ToolName } from "./tools.js";

/**
 * What a project allows an agent to do.
 *
 * This lives in the shared package because it is enforced twice, on purpose.
 * The gateway is the authority on the policy the account holder set, and must
 * check it, because an older CLI would simply ignore a field it does not know
 * and run the command anyway. The executor is the authority on the machine, and
 * must check it too, because that is the only side that can honour a local
 * `exeora.toml` and the only one still standing if the gateway is wrong.
 *
 * Both sides run the very functions below rather than two implementations that
 * agree today, which is the only way "checked twice" is worth more than
 * "checked once".
 */

export const POLICY_MODES = ["allow_all", "allow_list", "read_only"] as const;

export const CommandPolicy = z.object({
  /**
   * `allow_all` is the shape of every project that predates this setting, so it
   * is the default everywhere: turning a policy on is a decision someone makes,
   * never something that happens to a project on its own.
   *
   * `read_only` refuses every tool that changes anything. `allow_list` permits
   * the commands named in `allow`, and nothing else.
   */
  mode: z.enum(POLICY_MODES),
  /**
   * Programs `run_command` may invoke under `allow_list`, compared against the
   * first word of the command. Ignored in the other two modes.
   */
  allow: z.array(z.string()).default([]),
  /**
   * Whether a command may contain shell syntax under `allow_list`.
   *
   * Off by default, and the reason is the whole point of the mode. Commands run
   * through a shell, so `npm test; rm -rf ~` is one command whose first word is
   * `npm`. With this off, anything carrying shell metacharacters is refused
   * outright and the allow list means what it appears to mean. Turning it on
   * reduces the list to a suggestion, and the dashboard says so.
   */
  shell: z.boolean().default(false),
  /**
   * Whether a tool that changes something must be confirmed before it runs.
   *
   * A field rather than a fourth mode, because it is a different question. The
   * mode says what may happen at all; this says whether someone is asked first,
   * and both answers are useful together: an allow list that still asks, or a
   * project that permits everything but never silently.
   *
   * It only reaches clients that speak MCP 2026-07-28, which is what carries
   * the mechanism for asking. A client that cannot be asked is refused rather
   * than waved through, since the alternative makes the setting decorative.
   */
  approve: z.boolean().default(false),
});

export type CommandPolicy = z.infer<typeof CommandPolicy>;

/** What a project with no policy set gets. */
export const DEFAULT_POLICY: CommandPolicy = {
  mode: "allow_all",
  allow: [],
  shell: false,
  approve: false,
};

/**
 * What to fall back to when a policy was set but cannot be read.
 *
 * Not the same fallback as an unset policy, deliberately. An unreadable policy
 * is evidence that someone restricted this project, so opening it up is the one
 * answer that can be wrong in a direction that matters.
 */
export const CLOSED_POLICY: CommandPolicy = {
  mode: "read_only",
  allow: [],
  shell: false,
  approve: false,
};

/**
 * Whether this call has to be confirmed before it runs.
 *
 * Only the tools that change something. Asking before a `grep` would train
 * people to approve without reading, which is worse than not asking.
 */
export function needsApproval(policy: CommandPolicy, tool: ToolName): boolean {
  return policy.approve && !TOOL_DEFINITIONS[tool].readOnly;
}

/**
 * Characters that give a shell a second command, a substitution, or a file to
 * write. Any one of them makes the first word of a command a poor description
 * of what it will do.
 */
const SHELL_SYNTAX = /[;&|<>$`(){}[\]!*?~\n\r\\"']/;

export interface PolicyVerdict {
  allowed: boolean;
  /** Safe to show a caller: never echoes the command or anything from the host. */
  reason?: string;
}

const ALLOWED: PolicyVerdict = { allowed: true };

/**
 * Whether a policy permits a tool call.
 *
 * `run_command` is the interesting case; the rest are decided by whether the
 * tool changes anything, which `TOOL_DEFINITIONS` already records.
 */
export function policyAllows(policy: CommandPolicy, tool: ToolName, args: unknown): PolicyVerdict {
  if (policy.mode === "allow_all") return ALLOWED;

  if (!TOOL_DEFINITIONS[tool].readOnly && policy.mode === "read_only") {
    return {
      allowed: false,
      reason: "This project is read only. It allows no tool that changes it.",
    };
  }

  if (tool !== "run_command") return ALLOWED;
  if (policy.mode === "read_only") {
    return { allowed: false, reason: "This project is read only. It runs no commands." };
  }

  const command = (args as { command?: unknown } | null)?.command;
  if (typeof command !== "string") {
    return { allowed: false, reason: "No command was given." };
  }

  return commandAllowed(policy, command);
}

/**
 * Whether an `allow_list` policy permits one command string.
 *
 * Exported on its own so the dashboard can show what a list would do to an
 * example before anyone relies on it.
 */
export function commandAllowed(policy: CommandPolicy, command: string): PolicyVerdict {
  if (policy.mode === "allow_all") return ALLOWED;
  if (policy.mode === "read_only") {
    return { allowed: false, reason: "This project is read only. It runs no commands." };
  }

  if (!policy.shell && SHELL_SYNTAX.test(command)) {
    return {
      allowed: false,
      reason:
        "This project allows only plain commands from its allow list. " +
        "Shell syntax (pipes, redirection, substitution, chaining) is not permitted.",
    };
  }

  const program = firstWord(command);
  if (!program) return { allowed: false, reason: "No command was given." };

  if (!policy.allow.includes(program)) {
    return {
      allowed: false,
      // Names the program because the caller supplied it, and lists what is
      // permitted because an agent that cannot see the rule cannot obey it.
      reason:
        `\`${program}\` is not on this project's allow list. ` +
        `Permitted: ${policy.allow.length > 0 ? policy.allow.join(", ") : "nothing"}.`,
    };
  }

  return ALLOWED;
}

/**
 * A project's `exeora.toml`, which may leave anything out.
 *
 * Every field is optional, and that is load bearing rather than convenient: an
 * absent field means the file has no opinion, which is a different thing from
 * a field set to the restrictive value. A file that says only `mode =
 * "allow_list"` must not also silently switch `shell` off.
 */
export const LocalCommandPolicy = z.object({
  mode: z.enum(POLICY_MODES).optional(),
  allow: z.array(z.string()).optional(),
  shell: z.boolean().optional(),
  approve: z.boolean().optional(),
});

export type LocalCommandPolicy = z.infer<typeof LocalCommandPolicy>;

/**
 * The effective policy when a machine has an `exeora.toml` of its own.
 *
 * The remote policy is the primary one: it belongs to the account, and the
 * local file may only narrow it, never widen it. Whoever controls the machine
 * can tie their own hands further; they cannot untie them.
 *
 * Narrowing runs per field, and only where the file has an opinion. The
 * stricter mode wins, the allow lists intersect, and `shell` survives only if
 * both sides permit it.
 */
export function narrowPolicy(remote: CommandPolicy, local: LocalCommandPolicy): CommandPolicy {
  const mode = local.mode === undefined ? remote.mode : stricter(remote.mode, local.mode);

  // Asking is the strict direction, so a machine may turn it on where the
  // account did not, and may not turn it off where the account did.
  const approve = remote.approve || (local.approve ?? false);

  // Neither of these modes consults the list, so carrying one would only be
  // something to misread later.
  if (mode === "allow_all" || mode === "read_only") {
    return { mode, allow: [], shell: narrowShell(remote, local), approve };
  }

  // The list is only a restriction under allow_list. A side that is not in that
  // mode is not constraining which programs may run, so it contributes nothing
  // to intersect and its own list, if any, is not yet in force.
  const lists: string[][] = [];
  if (remote.mode === "allow_list") lists.push(remote.allow);
  if (local.mode === "allow_list" && local.allow) lists.push(local.allow);

  const allow = lists.reduce((kept, list) => kept.filter((program) => list.includes(program)));

  return { mode, allow, shell: narrowShell(remote, local), approve };
}

function narrowShell(remote: CommandPolicy, local: LocalCommandPolicy): boolean {
  return local.shell === undefined ? remote.shell : remote.shell && local.shell;
}

function stricter(a: CommandPolicy["mode"], b: CommandPolicy["mode"]): CommandPolicy["mode"] {
  // POLICY_MODES runs from most permissive to least, so the later one wins.
  return POLICY_MODES.indexOf(a) >= POLICY_MODES.indexOf(b) ? a : b;
}

/** The program a command runs, before any argument. */
function firstWord(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

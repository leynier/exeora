import { z } from "zod";
import { TOOL_DEFINITIONS, TOOL_NAMES, type ToolName } from "./tools.js";

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
   * Commands `run_command` may invoke under `allow_list`, and nothing else.
   * Ignored in the other two modes, where the mode already answers the
   * question.
   *
   * Each entry is a rule; see `matchesRule` for what one means.
   */
  allow: z.array(z.string()).default([]),
  /**
   * Commands `run_command` may never invoke, **in every mode, including
   * `allow_all`**, and checked before `allow`.
   *
   * Applying only under `allow_list` would make this decoration: that mode
   * already refuses everything it does not name. Its whole use is the project
   * that permits commands generally and still wants `sudo` and `rm -rf`
   * refused, which is a sentence only `allow_all` can express.
   *
   * A non-empty list also turns on the shell-syntax refusal that `allow_list`
   * has always had. Without that, `npm test; sudo rm -rf /` is one command
   * whose first word is `npm`, and a deny list naming `sudo` would let it
   * through while appearing not to. `shell = true` opts out and says so.
   */
  deny: z.array(z.string()).default([]),
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
  /**
   * Which tools exist here at all, or null for every one of them.
   *
   * The granularity `mode` cannot express. `read_only` is the only per-tool
   * statement the modes can make, and it is all-or-nothing: a project that
   * wants an agent to read and edit files but never run a command has no way to
   * say so without this.
   *
   * Null rather than "every name listed" so the meaning survives a new tool
   * being added: a project that never restricted its tools should not silently
   * refuse the next one to exist.
   */
  tools: z.array(z.enum(TOOL_NAMES)).nullable().default(null),
});

export type CommandPolicy = z.infer<typeof CommandPolicy>;

/** What a project with no policy set gets. */
export const DEFAULT_POLICY: CommandPolicy = {
  mode: "allow_all",
  allow: [],
  deny: [],
  shell: false,
  approve: false,
  tools: null,
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
  deny: [],
  shell: false,
  approve: false,
  // `read_only` already refuses everything that changes anything, and naming a
  // shorter list here would say something this fallback has no way to know.
  tools: null,
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
 * The same two questions for a downstream MCP tool.
 *
 * A separate pair because neither can lean on `TOOL_DEFINITIONS`: a downstream
 * tool's read-only-ness arrives as an annotation from its server, and an
 * annotation is a claim rather than a contract, so absence is read as
 * "changes something" — the safe direction, and the same one the canonical
 * tools' own definitions would give a tool nobody had annotated.
 *
 * The `tools` allow list is deliberately not consulted. It is a list of Exeora's
 * own tool names and cannot name a downstream one; the thing that decides
 * whether a downstream server exists at all is the machine's MCP configuration,
 * which is a decision the person running the CLI made by writing it.
 */
export function mcpPolicyAllows(
  policy: CommandPolicy,
  readOnlyHint: boolean | undefined,
): PolicyVerdict {
  if (!readOnlyHint && policy.mode === "read_only") {
    return {
      allowed: false,
      reason: "This project is read only. It allows no tool that changes it.",
    };
  }
  return ALLOWED;
}

export function needsMcpApproval(
  policy: CommandPolicy,
  readOnlyHint: boolean | undefined,
): boolean {
  return policy.approve && !readOnlyHint;
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
  // First, because it is the broadest statement a project can make: a tool that
  // does not exist here is not worth asking any further question about.
  if (policy.tools && !policy.tools.includes(tool)) {
    return {
      allowed: false,
      // Lists what is permitted, because an agent that cannot see the rule
      // cannot obey it, and will otherwise keep trying.
      reason:
        `This project does not offer \`${tool}\`. ` +
        `Permitted: ${policy.tools.length > 0 ? policy.tools.join(", ") : "nothing"}.`,
    };
  }

  if (!TOOL_DEFINITIONS[tool].readOnly && policy.mode === "read_only") {
    return {
      allowed: false,
      reason: "This project is read only. It allows no tool that changes it.",
    };
  }

  // Every other tool is decided by what it is, which the two checks above have
  // already settled. Only the two that name a command have arguments worth
  // reading, and they are held to the same lists: `start_command` runs exactly
  // what `run_command` runs, for longer, so a policy that distinguished them
  // would be one an agent could step around by picking the other name.
  if (tool !== "run_command" && tool !== "start_command") return ALLOWED;

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
  if (policy.mode === "read_only") {
    return { allowed: false, reason: "This project is read only. It runs no commands." };
  }

  const words = tokenize(command);
  const program = words[0];
  if (!program) return { allowed: false, reason: "No command was given." };

  /**
   * Whether the first word of this command describes what it will do.
   *
   * True under `allow_list`, which has always refused shell syntax, and now
   * also whenever a deny list exists. Both are lists compared against words,
   * and `npm test; sudo rm -rf /` is one command whose first word is `npm`:
   * without this, either list would appear to mean something it did not.
   */
  const readable = policy.mode === "allow_list" || policy.deny.length > 0;

  if (readable && !policy.shell && SHELL_SYNTAX.test(command)) {
    return {
      allowed: false,
      reason:
        "This project allows only plain commands. " +
        "Shell syntax (pipes, redirection, substitution, chaining) is not permitted.",
    };
  }

  // Denial before permission, and in every mode. Under `allow_list` this is
  // belt and braces; under `allow_all` it is the only thing being asked.
  if (policy.deny.some((rule) => matchesRule(rule, words))) {
    return {
      allowed: false,
      reason: `\`${program}\` is on this project's deny list.`,
    };
  }

  if (policy.mode === "allow_all") return ALLOWED;

  if (!policy.allow.some((rule) => matchesRule(rule, words))) {
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
 * Whether one rule describes this command.
 *
 * A rule is a sequence of words, and a trailing `*` stands for any words that
 * follow:
 *
 * ```text
 * npm            any npm command      npm, npm test, npm run build
 * git push       that command exactly git push, but not git push --force
 * git *          any git command      git, git push origin main
 * cargo build *  that, plus arguments cargo build --release
 * ```
 *
 * **A single word still means the program and any arguments**, which is what a
 * one-word entry meant before rules could be longer, and changing that would
 * quietly tighten every allow list already written. Two or more words with no
 * `*` is the exact form, which is the only way to say "this and nothing else".
 *
 * Deliberately not a glob. `*` is honoured as the final word and nowhere else,
 * because a syntax that looks like a glob without being one is misread rather
 * than learned, and because a `*` inside a real command is refused as shell
 * syntax long before it gets here.
 */
export function matchesRule(rule: string, words: readonly string[]): boolean {
  const parts = tokenize(rule);
  if (parts.length === 0) return false;

  const wildcard = parts[parts.length - 1] === "*";
  const fixed = wildcard ? parts.slice(0, -1) : parts;

  // The one-word case, kept as it was: the program, whatever follows it.
  if (!wildcard && fixed.length === 1) return words[0] === fixed[0];

  if (words.length < fixed.length) return false;
  if (!wildcard && words.length !== fixed.length) return false;

  return fixed.every((part, index) => words[index] === part);
}

/** A command or a rule as its words. */
function tokenize(value: string): string[] {
  const trimmed = value.trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
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
  deny: z.array(z.string()).optional(),
  shell: z.boolean().optional(),
  approve: z.boolean().optional(),
  tools: z.array(z.enum(TOOL_NAMES)).optional(),
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
 * stricter mode wins, the allow lists and tool lists intersect, the deny lists
 * unite, and `shell` survives only if both sides permit it.
 */
export function narrowPolicy(remote: CommandPolicy, local: LocalCommandPolicy): CommandPolicy {
  const mode = local.mode === undefined ? remote.mode : stricter(remote.mode, local.mode);

  // Asking is the strict direction, so a machine may turn it on where the
  // account did not, and may not turn it off where the account did.
  const approve = remote.approve || (local.approve ?? false);

  // Refusing is the strict direction too, so the lists unite rather than
  // intersect: a command either side denies is denied. Note the asymmetry with
  // `allow` below, and that it is the same rule seen from the other end.
  const deny = [...new Set([...remote.deny, ...(local.deny ?? [])])];

  // Null is "every tool", so it constrains nothing and the other side stands
  // alone; two lists keep only what both name.
  const tools =
    local.tools === undefined
      ? remote.tools
      : remote.tools === null
        ? [...local.tools]
        : remote.tools.filter((tool) => local.tools?.includes(tool));

  const shell = narrowShell(remote, local);

  // Neither of these modes consults the allow list, so carrying one would only
  // be something to misread later. The deny list survives: it applies in every
  // mode, which is the whole reason it exists.
  if (mode === "allow_all" || mode === "read_only") {
    return { mode, allow: [], deny, shell, approve, tools };
  }

  // The allow list is only a restriction under allow_list. A side that is not in
  // that mode is not constraining which programs may run, so it contributes
  // nothing to intersect and its own list, if any, is not yet in force.
  const lists: string[][] = [];
  if (remote.mode === "allow_list") lists.push(remote.allow);
  if (local.mode === "allow_list" && local.allow) lists.push(local.allow);

  const allow = lists.reduce((kept, list) => kept.filter((program) => list.includes(program)));

  return { mode, allow, deny, shell, approve, tools };
}

function narrowShell(remote: CommandPolicy, local: LocalCommandPolicy): boolean {
  return local.shell === undefined ? remote.shell : remote.shell && local.shell;
}

function stricter(a: CommandPolicy["mode"], b: CommandPolicy["mode"]): CommandPolicy["mode"] {
  // POLICY_MODES runs from most permissive to least, so the later one wins.
  return POLICY_MODES.indexOf(a) >= POLICY_MODES.indexOf(b) ? a : b;
}

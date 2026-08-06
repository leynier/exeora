import { type CommandPolicy, LocalCommandPolicy } from "@exeora/protocol";

/**
 * Turning flags into an `exeora.toml`.
 *
 * Its own module rather than part of `index.ts`, so the parts that decide
 * anything can be tested without running the CLI. What is left there is the
 * asking, which is presentation.
 */

export interface PolicyFlags {
  mode?: string | undefined;
  allow?: string | undefined;
  deny?: string | undefined;
  tools?: string | undefined;
}

/**
 * The flags read as a policy, with anything unmentioned left unmentioned.
 *
 * Absent stays absent all the way through. An `exeora.toml` that omits a key
 * has no opinion about it, which is a different thing from asking for the
 * strictest value, and the meaning of the whole file rests on that difference.
 */
export function fromFlags(flags: PolicyFlags): LocalCommandPolicy {
  const draft = {
    ...(flags.mode ? { mode: flags.mode } : {}),
    ...(flags.allow ? { allow: splitList(flags.allow) } : {}),
    ...(flags.deny ? { deny: splitList(flags.deny) } : {}),
    ...(flags.tools ? { tools: splitList(flags.tools) } : {}),
  };

  // Validated with the very schema the executor reads the file back with, so a
  // typo in a flag is caught here rather than at the next tool call.
  const parsed = LocalCommandPolicy.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  }

  return parsed.data;
}

/**
 * The policy as TOML, written by hand rather than by a library.
 *
 * The file has at most six keys of two shapes, and the comments are half the
 * point of generating it: a file someone can read and edit beats a correct one
 * they are afraid to touch.
 */
export function renderPolicyToml(local: LocalCommandPolicy): string {
  const lines = [
    "# What agents may do in this project, on this machine.",
    "#",
    "# This file can only narrow what the project's policy already allows,",
    "# never widen it. Every key is optional: leaving one out means this file",
    "# has no opinion about it, which is not the same as asking for the",
    "# strictest value.",
    "",
  ];

  if (local.mode) lines.push(`mode = ${JSON.stringify(local.mode)}`);
  if (local.allow) lines.push(`allow = ${renderList(local.allow)}`);
  if (local.deny) lines.push(`deny = ${renderList(local.deny)}`);
  if (local.shell !== undefined) lines.push(`shell = ${local.shell}`);
  if (local.approve !== undefined) lines.push(`approve = ${local.approve}`);
  if (local.tools) lines.push(`tools = ${renderList(local.tools)}`);

  return `${lines.join("\n")}\n`;
}

function renderList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/**
 * A policy in a few readable lines, for `init` to show after writing.
 *
 * What this is for: the file it just wrote is only half the answer. The account
 * holds the other half and this one can only narrow it, so someone who writes
 * `mode = "allow_all"` and expects it to widen anything needs to see that it
 * did not. Showing the combination is the only way that lands.
 */
export function describePolicy(policy: CommandPolicy): string[] {
  const lines = [`Mode     ${policy.mode}`];

  if (policy.mode === "allow_list") {
    lines.push(`Allow    ${policy.allow.length > 0 ? policy.allow.join(", ") : "nothing"}`);
  }
  if (policy.deny.length > 0) lines.push(`Deny     ${policy.deny.join(", ")}`);

  lines.push(`Shell    ${policy.shell ? "permitted" : "refused"}`);
  lines.push(`Confirm  ${policy.approve ? "every change" : "never"}`);
  lines.push(`Tools    ${policy.tools ? policy.tools.join(", ") : "all of them"}`);

  return lines;
}

/** A comma separated flag as a list, tolerant of spaces and empty entries. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

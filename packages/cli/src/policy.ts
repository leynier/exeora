import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type CommandPolicy,
  DEFAULT_POLICY,
  LocalCommandPolicy,
  narrowPolicy,
} from "@exeora/protocol";
import { parse as parseToml } from "smol-toml";

/**
 * The project's own `exeora.toml`, and what it does to the account's policy.
 *
 * The remote policy is the primary one. This file may only narrow it: someone
 * who controls a machine can restrict what an agent may do there beyond what
 * the account already allows, and cannot grant themselves anything the account
 * does not. `narrowPolicy` in the shared package is what enforces that, so both
 * sides agree on the meaning of "narrower" by construction.
 *
 * ```toml
 * # exeora.toml, in the project root
 * mode = "allow_list"     # allow_all | allow_list | read_only
 * allow = ["npm", "git"]
 * shell = false
 * ```
 *
 * Every key is optional, and leaving one out means the file has no opinion
 * about it rather than asking for the strictest value.
 */

export const POLICY_FILENAME = "exeora.toml";

/** What was read, and whether it changed anything, so `connect` can say so. */
export interface EffectivePolicy {
  policy: CommandPolicy;
  /** Set when the file exists but could not be used, for a line on the terminal. */
  problem?: string;
}

interface Cached {
  modifiedAt: number;
  size: number;
  local: LocalCommandPolicy | { problem: string };
}

/**
 * Cached per project root and keyed by the file's mtime and size.
 *
 * A tool call must not pay for a file read, and an agent makes hundreds a
 * minute. Keying on both means editing the file takes effect on the next call
 * rather than on the next reconnect, without anything watching it.
 */
const cache = new Map<string, Cached>();

export async function effectivePolicy(
  root: string,
  remote: CommandPolicy | undefined,
): Promise<EffectivePolicy> {
  // No policy on the call means a gateway that predates the field. The file is
  // still read: it is the machine owner's setting, and it holds whether or not
  // the account has one.
  const account = remote ?? DEFAULT_POLICY;
  const local = await readLocalPolicy(root);

  if (local === undefined) return { policy: account };
  if ("problem" in local) return { policy: account, problem: local.problem };

  return { policy: narrowPolicy(account, local) };
}

/**
 * Reads and parses `exeora.toml`, or returns undefined when there is none.
 *
 * A file that cannot be read is reported rather than obeyed. Treating a
 * malformed file as the strictest possible policy would stop a project dead
 * over a typo; treating it as absent, silently, would let a typo remove a
 * restriction someone believed they had. Saying so and falling back to the
 * account's policy is the only option that surprises nobody.
 */
async function readLocalPolicy(
  root: string,
): Promise<LocalCommandPolicy | { problem: string } | undefined> {
  const path = join(root, POLICY_FILENAME);

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(path);
  } catch {
    cache.delete(root);
    return undefined;
  }

  const modifiedAt = stats.mtimeMs;
  const { size } = stats;

  const cached = cache.get(root);
  if (cached && cached.modifiedAt === modifiedAt && cached.size === size) return cached.local;

  const local = await parseLocalPolicy(path);
  cache.set(root, { modifiedAt, size, local });

  return local;
}

async function parseLocalPolicy(path: string): Promise<LocalCommandPolicy | { problem: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { problem: `${POLICY_FILENAME} could not be read; the account's policy applies.` };
  }

  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch {
    return { problem: `${POLICY_FILENAME} is not valid TOML; the account's policy applies.` };
  }

  const result = LocalCommandPolicy.safeParse(parsed);
  if (!result.success) {
    return {
      problem: `${POLICY_FILENAME} has a setting this CLI does not understand; the account's policy applies.`,
    };
  }

  return result.data;
}

/** Forgets what was read, for tests and for anything that moves a project. */
export function forgetPolicyCache(): void {
  cache.clear();
}

import { z } from "zod";

/**
 * What makes a project one project: its repository.
 *
 * The same repository is written many ways, `git@github.com:acme/api.git` on
 * one machine and `https://github.com/acme/api` on another, and a project that
 * lives on both has to recognise itself. `repositoryKey` is the form they all
 * reduce to. It identifies; it is never cloned from.
 */

/** Announced in `hello.capabilities.features` by a CLI that can clone a project it does not have. */
export const PROJECT_CLONE_FEATURE = "project-clone-v1";

const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;
/** scheme, host and path of an address with a scheme. No `URL`: this package runs where there is none. */
const WITH_SCHEME =
  /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?(?:[?#].*)?$/i;
const SCHEMES = ["https", "http", "ssh", "git", "git+ssh"];

interface Parts {
  host: string;
  /** As written, without the slashes around it or a trailing `.git`. */
  path: string;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A loop, not `/\/+$/`: that pattern backtracks quadratically on a long run of slashes. */
function withoutSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "/") start++;
  while (end > start && value[end - 1] === "/") end--;
  return value.slice(start, end);
}

function parts(url: string | null | undefined): Parts | null {
  const text = url?.trim();
  if (!text) return null;

  let host: string;
  let raw: string;
  const schemed = WITH_SCHEME.exec(text);
  if (schemed) {
    if (!schemed[1] || !SCHEMES.includes(schemed[1].toLowerCase())) return null;
    host = schemed[2] ?? "";
    raw = decoded(schemed[3] ?? "");
  } else {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
    const scp = SCP_LIKE.exec(text);
    // A drive letter reads like a host, and a path is not a repository on one.
    if (!scp?.[1] || !scp[2] || scp[1].length < 2) return null;
    host = scp[1];
    raw = scp[2];
  }

  const path = withoutSlashes(withoutSlashes(raw).replace(/\.git$/i, ""));
  const where = host.toLowerCase().replace(/^www\./, "");
  if (!where || !path || path.includes("..") || /\s/.test(path)) return null;
  return { host: where, path };
}

/**
 * `host/owner/name`, lowercased, with no scheme, user, port or `.git`.
 *
 * Null for anything that does not name a repository on a host: a local path,
 * a `file://` URL, an empty string. Those stay what they are today, a directory
 * on one machine.
 */
export function repositoryKey(url: string | null | undefined): string | null {
  const found = parts(url);
  return found ? `${found.host}/${found.path.toLowerCase()}` : null;
}

/**
 * The https address of a repository, which is the form the gateway stores. The
 * path keeps the case it was written in: hosts that care are rare, and one
 * that does would refuse the lowercased form.
 */
export function httpsRepositoryUrl(url: string): string | null {
  const found = parts(url);
  return found ? `https://${found.host}/${found.path}.git` : null;
}

/** The ssh address of the same repository, for a machine whose git speaks ssh. */
export function sshRepositoryUrl(url: string): string | null {
  const found = parts(url);
  return found ? `git@${found.host}:${found.path}.git` : null;
}

/**
 * A repository as the gateway describes it to a machine that is about to hold
 * a copy. `credential` says whose credentials the clone should try first:
 * `exeora` asks the gateway for a short-lived token through the CLI's
 * credential helper, `machine` uses what git on that machine already has.
 */
export const RepositoryRef = z.object({
  url: z.string().min(1).max(1000),
  defaultBranch: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  credential: z.enum(["exeora", "machine"]).default("machine"),
});

export type RepositoryRef = z.infer<typeof RepositoryRef>;

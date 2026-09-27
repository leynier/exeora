import { explainFailure } from "./machine-errors.js";

/**
 * Asks a repository what git would ask it first, before a machine is made.
 *
 * A machine that cannot clone says so a minute after it was asked for, and by
 * then the dialog that asked is closed. The same question costs one request
 * from here: the reference advertisement of the smart HTTP protocol, which
 * answers whether the address is a repository, whether the token opens it,
 * and which branch its HEAD points at.
 *
 * Takes the fetcher last, like everything else that leaves the gateway.
 */

export type ProbeErrorCode =
  | "repo_not_found"
  | "clone_auth_failed"
  | "branch_not_found"
  | "unreachable";

export type Probe =
  | { ok: true; defaultBranch: string }
  | { ok: false; code: ProbeErrorCode; message: string };

export interface ProbeCredential {
  username: string;
  password: string;
}

/** Enough for the first reference and its capabilities many times over. */
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

const UNREACHABLE =
  "The repository's host could not be reached. Check the address, then try again.";

export async function probeRepository(
  url: string,
  credential: ProbeCredential | undefined,
  fetcher: typeof fetch,
): Promise<Probe> {
  let address: URL;
  try {
    address = new URL(`${url.replace(/\/+$/, "").replace(/\.git$/i, "")}.git/info/refs`);
  } catch {
    return failed("unreachable", UNREACHABLE);
  }
  if (address.protocol !== "https:") return failed("unreachable", UNREACHABLE);
  address.search = "?service=git-upload-pack";

  // No `Git-Protocol: version=2`: the second version answers with its
  // capabilities and no references, and HEAD's branch is among the first's.
  const origin = address.origin;
  let response: Response;
  try {
    for (let hop = 0; ; hop += 1) {
      response = await fetcher(address.toString(), {
        headers: {
          "User-Agent": "git/exeora-gateway",
          Accept: "application/x-git-upload-pack-advertisement",
          // Only to the host it was given for: a redirect elsewhere is
          // followed, as git follows a renamed repository, but without it.
          ...(credential && address.origin === origin
            ? { Authorization: `Basic ${btoa(`${credential.username}:${credential.password}`)}` }
            : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      await response.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS) return failed("unreachable", UNREACHABLE);
      address = new URL(location, address);
      if (address.protocol !== "https:") return failed("unreachable", UNREACHABLE);
    }
  } catch {
    return failed("unreachable", UNREACHABLE);
  }

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    // Put the way git puts it, so the words are the ones a machine that
    // failed to clone would have been given.
    const failure = explainFailure(`The requested URL returned error: ${response.status}`);
    return failed(
      failure.code === "clone_auth_failed" ? "clone_auth_failed" : "repo_not_found",
      failure.message,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failed("unreachable", UNREACHABLE);
  }
  // Anything else that answers 200 is a web page, not a repository.
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/x-git-upload-pack-advertisement")) {
    await response.body?.cancel().catch(() => undefined);
    return failed("repo_not_found", explainFailure("repository not found").message);
  }

  const advertisement = await readAdvertisement(response);
  const branch = defaultBranchOf(advertisement);
  if (branch) return { ok: true, defaultBranch: branch };
  return failed(
    "branch_not_found",
    advertisement.some((line) => line.includes(" refs/heads/"))
      ? "The repository does not say which branch is its default. Name the branch to use."
      : "The repository has no branches yet. Push a first commit, then try again.",
  );
}

/**
 * The lines of a reference advertisement, as far as they were read.
 *
 * Each is framed by its own length, four hexadecimal digits that count
 * themselves, and `0000` closes a section. A repository with many references
 * sends megabytes of them; what is wanted is in the first, so reading stops
 * as soon as that one is whole.
 */
async function readAdvertisement(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  let bytes = new Uint8Array(0);
  let lines: string[] = [];
  try {
    while (bytes.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (value) {
        const joined = new Uint8Array(bytes.length + value.length);
        joined.set(bytes);
        joined.set(value, bytes.length);
        bytes = joined;
        lines = pktLines(bytes);
        if (lines.some((line) => symrefOf(line) !== undefined || isEmpty(line))) break;
      }
      if (done) break;
    }
  } catch {
    // What was read before the connection broke is still worth parsing.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return lines;
}

export function pktLines(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = Number.parseInt(decoder.decode(bytes.subarray(offset, offset + 4)), 16);
    if (Number.isNaN(length)) break;
    // Below four there is no line: 0000 ends a section, and the rest are
    // markers the first version never sends.
    if (length < 4) {
      offset += 4;
      continue;
    }
    if (offset + length > bytes.length) break;
    lines.push(decoder.decode(bytes.subarray(offset + 4, offset + length)).replace(/\n$/, ""));
    offset += length;
  }
  return lines;
}

/** `symref=HEAD:refs/heads/<branch>` among the capabilities after the NUL. */
function symrefOf(line: string): string | undefined {
  const nul = line.indexOf("\0");
  if (nul < 0) return undefined;
  for (const capability of line.slice(nul + 1).split(" ")) {
    if (capability.startsWith("symref=HEAD:refs/heads/")) {
      return capability.slice("symref=HEAD:refs/heads/".length) || undefined;
    }
  }
  return undefined;
}

/**
 * What a repository nothing was pushed to sends in place of a first
 * reference. It may still name the branch HEAD will be on, which is no use:
 * a machine needs a branch that exists.
 */
function isEmpty(line: string): boolean {
  return (line.split("\0")[0] ?? "").endsWith(" capabilities^{}");
}

export function defaultBranchOf(lines: string[]): string | undefined {
  if (lines.some(isEmpty)) return undefined;
  for (const line of lines) {
    const branch = symrefOf(line);
    if (branch) return branch;
  }
  // A server too old to say: the branch that is where HEAD is, the usual
  // names first, when exactly that can be told from what was read.
  const refs = lines
    .filter((line) => !line.startsWith("#"))
    .map((line) => {
      const [sha = "", name = ""] = (line.split("\0")[0] ?? "").split(" ");
      return { sha, name };
    });
  const head = refs.find((ref) => ref.name === "HEAD");
  if (!head) return undefined;
  const at = refs
    .filter((ref) => ref.sha === head.sha && ref.name.startsWith("refs/heads/"))
    .map((ref) => ref.name.slice("refs/heads/".length));
  return at.find((name) => name === "main") ?? at.find((name) => name === "master") ?? at[0];
}

/**
 * The addresses a repository had before it was renamed or moved, as
 * `cloud_projects.previous_repo_urls` keeps them: a JSON array. Anything
 * that is not a plain https address is left out, since each of them ends up
 * in a machine's payload, where nothing else is accepted.
 */
export function previousUrls(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => {
      if (typeof entry !== "string" || /\s/.test(entry)) return false;
      try {
        const url = new URL(entry);
        return url.protocol === "https:" && url.username === "" && url.password === "";
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function failed(code: ProbeErrorCode, message: string): Probe {
  return { ok: false, code, message };
}

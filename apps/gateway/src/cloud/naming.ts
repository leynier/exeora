import { CLOUD_MAIN_WORKSPACE_SLUG } from "@exeora/protocol";

/**
 * Names for cloud workspaces: the slug a branch becomes, and what git would
 * accept as a branch at all. Both mirror rules that exist elsewhere (the CLI's
 * `slugify`, `git check-ref-format`) so a workspace made here looks like one
 * made on a laptop and a branch accepted here is one the clone will accept.
 */

/** The same derivation the CLI applies to a branch name, so slugs match across both. */
export function slugFromBranch(branch: string): string {
  let result = "";
  let hyphen = false;
  for (const character of branch.toLowerCase()) {
    if (/[a-z0-9]/.test(character)) {
      result += character;
      hyphen = false;
    } else if (result.length > 0 && !hyphen) {
      result += "-";
      hyphen = true;
    }
    if (result.length >= 60) break;
  }
  result = result.replace(/-+$/, "");
  if (result === "" || result === CLOUD_MAIN_WORKSPACE_SLUG)
    return `${result || "workspace"}-branch`;
  return result;
}

/**
 * The rules of `git check-ref-format --branch`, all of them, so a branch that
 * reserves a machine is one the clone will check out. A name refused only by
 * git would leave a machine running the default branch under the wrong label.
 */
export function validBranch(branch: string): boolean {
  if (branch.length === 0 || branch.length > 255 || branch === "@" || branch === "HEAD") {
    return false;
  }
  for (const character of branch) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  if (/[\s~^:?*[\\]/.test(branch)) return false;
  if (branch.startsWith("-") || branch.endsWith(".")) return false;
  if (branch.includes("..") || branch.includes("@{")) return false;
  return branch
    .split("/")
    .every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

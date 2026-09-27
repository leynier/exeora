/**
 * Why a machine could not be made, in words somebody can act on.
 *
 * What provisioning has in hand when it fails is the tail of a script's output
 * or of a service log, written for whoever debugs the gateway. The person
 * looking at the dashboard, and the agent that asked for a workspace, need the
 * cause and what to do about it. The raw text is kept beside it as the detail,
 * for the day the sentence is not enough.
 */

export const MACHINE_ERROR_CODES = [
  "clone_auth_failed",
  "repo_not_found",
  "branch_not_found",
  "machine_unavailable",
  "timed_out",
  "tools_failed",
  "setup_failed",
] as const;

export type MachineErrorCode = (typeof MACHINE_ERROR_CODES)[number];

export interface MachineFailure {
  code: MachineErrorCode;
  /** One or two sentences: what happened and what to do. */
  message: string;
  /** What the machine actually said, when that is more than the message. */
  detail: string | null;
}

const MESSAGES: Record<Exclude<MachineErrorCode, "branch_not_found" | "tools_failed">, string> = {
  clone_auth_failed: "The repository refused access. Set a token that can read it, then retry.",
  repo_not_found:
    "No repository was found at that address. If it is private, set a token that can read it, then retry.",
  machine_unavailable: "Exeora Cloud could not start the machine. Retry in a few minutes.",
  timed_out: "Setting the machine up took too long. Retry to try again.",
  setup_failed: "The machine could not be set up. Retry, and check the details if it fails again.",
};

/**
 * What git and the hosts say when credentials are missing or wrong. A private
 * repository asked for without a token answers "not found" on GitHub, which is
 * why that case names the token too.
 */
const AUTH =
  /authentication failed|could not read username|could not read password|terminal prompts disabled|invalid username or (password|token)|http basic: access denied|permission denied \(publickey|returned error: 40[13]\b/i;
const NOT_FOUND =
  /repository not found|repository '.*' not found|does not appear to be a git repository|returned error: 404\b|project you were looking for could not be found/i;
const SPRITES = /sprites (api|token)|could not reach the sprites/i;
const BRANCH =
  /^the (branch|base) .+ (does not exist in|is not a branch or tag of) the repository\.?$/i;
const TIMED_OUT = /timed out/i;
/** The one tool a machine is not handed over without. Written by the tools step. */
const TOOLS = /^The GitHub CLI \(gh\) could not be installed on the machine\b/;

/** Reads a failure as it was thrown and says what it means. */
export function explainFailure(raw: string): MachineFailure {
  const text = raw.trim();

  // The script's own verdicts are already sentences about the request.
  if (BRANCH.test(text)) return { code: "branch_not_found", message: text, detail: null };
  if (TOOLS.test(text)) {
    // The first line is the sentence, and what the machine printed follows.
    const [message = text, ...rest] = text.split("\n");
    const detail = rest.join("\n").trim();
    return { code: "tools_failed", message, detail: detail.length > 0 ? detail : null };
  }

  const code: keyof typeof MESSAGES = SPRITES.test(text)
    ? "machine_unavailable"
    : AUTH.test(text)
      ? "clone_auth_failed"
      : NOT_FOUND.test(text)
        ? "repo_not_found"
        : TIMED_OUT.test(text)
          ? "timed_out"
          : "setup_failed";

  return { code, message: MESSAGES[code], detail: text.length > 0 ? text : null };
}

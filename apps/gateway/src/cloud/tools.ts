import script from "./tools.sh";

/**
 * The toolset of a machine: the script that installs it, and how to read
 * what the script said.
 *
 * The script is fed to the machine over the exec API as it is, with nothing
 * prepended: it takes no payload and carries no secret. It prints one line
 * per tool, one for the machine it found itself on, and the sentinel last.
 * Only a tool that is required can fail it, and today that is `gh` alone;
 * every other tool that could not be installed is in the report, on a
 * machine that is usable without it.
 */

export const TOOLS_SCRIPT: string = script;
export const TOOLS_SENTINEL = "EXEORA_TOOLS_OK";

/**
 * How long the exec call should wait. The script stops starting new work
 * after 270 seconds and bounds each step, so this is only ever reached by a
 * machine that stopped answering.
 */
export const TOOLS_TIMEOUT_MS = 330_000;

export type ToolState = "present" | "installed" | "failed" | "skipped";

export interface ToolReport {
  name: string;
  /** `present` was there already; `skipped` could not even be attempted. */
  state: ToolState;
  version: string | null;
  /** Whether the machine is unusable without it. */
  required: boolean;
  /** Why it failed or was skipped, or where an installed one came from. */
  reason: string | null;
}

export interface ToolsEnvironment {
  /** `ID-VERSION_ID` of /etc/os-release, such as `ubuntu-25.10`. */
  os: string | null;
  arch: string | null;
  /** Root answers without asking for a password. */
  sudo: boolean;
  apt: boolean;
  /** /dev/shm is kept in memory. */
  memoryDisk: boolean;
}

export interface ToolsReport {
  tools: ToolReport[];
  environment: ToolsEnvironment;
}

const TOOL_LINE = /^EXEORA_TOOL (\S+) (present|installed|failed|skipped) (\S+) (yes|no)(?: (.*))?$/;
const ENV_MARK = "EXEORA_ENV ";
const FAILED_MARK = "EXEORA_TOOLS_FAILED";

const lines = (output: string): string[] => output.split(/\r?\n/).map((line) => line.trim());
const orNull = (value: string | undefined): string | null =>
  value === undefined || value === "" || value === "-" ? null : value;

/**
 * Reads the report out of a run's output. Lines that are not of the report
 * are passed over, as is a last line the output was cut in the middle of; a
 * tool reported twice is what it was reported as last. An output with no
 * environment line reads as a machine nothing is known about.
 */
export function parseToolsReport(output: string): ToolsReport {
  const tools = new Map<string, ToolReport>();
  const environment: ToolsEnvironment = {
    os: null,
    arch: null,
    sudo: false,
    apt: false,
    memoryDisk: false,
  };
  for (const line of lines(output)) {
    const tool = TOOL_LINE.exec(line);
    if (tool) {
      const name = tool[1] as string;
      tools.set(name, {
        name,
        state: tool[2] as ToolState,
        version: orNull(tool[3]),
        required: tool[4] === "yes",
        reason: orNull(tool[5]?.trim()),
      });
      continue;
    }
    if (!line.startsWith(ENV_MARK)) continue;
    const fields = new Map<string, string>();
    for (const pair of line.slice(ENV_MARK.length).split(/\s+/)) {
      const cut = pair.indexOf("=");
      if (cut > 0) fields.set(pair.slice(0, cut), pair.slice(cut + 1));
    }
    environment.os = orNull(fields.get("os"));
    environment.arch = orNull(fields.get("arch"));
    environment.sudo = fields.get("sudo") === "yes";
    environment.apt = fields.get("apt") === "yes";
    environment.memoryDisk = fields.get("shm") === "yes";
  }
  return { tools: [...tools.values()], environment };
}

/** Whether a run finished with the machine usable: the sentinel comes last. */
export function toolsSucceeded(result: { exitCode: number | null; output: string }): boolean {
  return result.exitCode === 0 && result.output.trimEnd().endsWith(TOOLS_SENTINEL);
}

/**
 * What to tell a person when a required tool could not be installed: the
 * cause, in the script's own words, and what to do. Null when the script
 * did not say so, which is a failure of another kind.
 */
export function toolsFailure(output: string): string | null {
  const line = lines(output).find(
    (candidate) => candidate === FAILED_MARK || candidate.startsWith(`${FAILED_MARK} `),
  );
  if (line === undefined) return null;
  const [name, ...words] = line.slice(FAILED_MARK.length).trim().split(/\s+/);
  const what = !name || name === "gh" ? "The GitHub CLI (gh)" : name;
  const reason = words.join(" ").replace(/[.\s]+$/, "");
  return reason
    ? `${what} could not be installed on the machine: ${reason}. Retry to try again.`
    : `${what} could not be installed on the machine. Retry to try again.`;
}

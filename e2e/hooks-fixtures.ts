import { github, machines } from "./fixtures.js";

/**
 * What the mocked gateway answers about scripts and tools, shaped as the real
 * one answers: the scripts a project's page holds, what became of them on an
 * instance, and what the instance found to install.
 *
 * Every instance here is the one for `feature/search` of `widgets`, which is
 * online in the account the other specs use. A script that fails leaves an
 * instance ready, so none of these is ever in `failed`.
 */

const now = Date.now();

export const SEARCH = "dev_cloud_search";

export const savedScripts = {
  install: "pnpm install --frozen-lockfile\n",
  resume: null as string | null,
  runRepositoryScripts: true,
  updatedAt: now - 3_600_000,
};

export function hookRun(patch: Record<string, unknown> = {}) {
  return {
    runId: "run_install_1",
    status: "failed",
    source: "dashboard",
    trigger: "setup",
    scriptSha256: null as string | null,
    exitCode: 3 as number | null,
    startedAt: now - 312_000,
    finishedAt: (now - 300_000) as number | null,
    output: "+ pnpm install --frozen-lockfile\nERR_PNPM_OUTDATED_LOCKFILE  Cannot install" as
      | string
      | undefined,
    truncated: true,
    ...patch,
  };
}

export const timedOutResume = hookRun({
  runId: "run_resume_1",
  status: "timed_out",
  source: "repository",
  trigger: "cold",
  exitCode: null,
  startedAt: now - 180_000,
  finishedAt: now - 60_000,
  output: "waiting for the database...",
  truncated: false,
});

export function hooks(patch: Record<string, unknown> = {}) {
  return { supported: true, install: null, resume: null, ...patch };
}

function tool(name: string, patch: Record<string, unknown> = {}) {
  return {
    name,
    state: "installed",
    version: null as string | null,
    required: false,
    reason: null as string | null,
    ...patch,
  };
}

/** An instance with no `sudo`: what needs it is missing, and the rest is there. */
export const toolsReport = {
  tools: [
    tool("gh", { version: "2.63.0", required: true }),
    tool("git-lfs", { state: "present" }),
    tool("make", { state: "present" }),
    tool("uv"),
    tool("ripgrep"),
    tool("jq", { state: "failed", reason: "apt could not find the package" }),
    tool("yq", { state: "failed", reason: "no release for this system" }),
    tool("tmux", { state: "skipped", reason: "needs sudo, which this instance does not have" }),
  ],
  environment: { os: "linux", arch: "x86_64", sudo: false, apt: true, memoryDisk: false },
};

/** Every machine of the account, with the instance for `feature/search` changed. */
export function machinesWith(patch: Record<string, unknown>) {
  return machines.map((machine) =>
    machine.deviceId === SEARCH ? { ...machine, ...patch } : machine,
  );
}

export const githubWaiting = {
  ...github,
  installations: github.installations.map((installation) => ({
    ...installation,
    pendingPermissions: ["issues", "actions", "checks", "statuses", "workflows"],
  })),
};

export const githubAccepted = {
  ...github,
  installations: github.installations.map((installation) => ({
    ...installation,
    pendingPermissions: [] as string[],
  })),
};

import {
  CLOUD_WAKE_PORT,
  CLOUD_WORKSPACE_ROOT,
  type CloudCliConfig,
  CloudCliConfig as CloudCliConfigSchema,
} from "@exeora/protocol";
import template from "./bootstrap.sh";
import type { SpriteServiceSpec } from "./sprites.js";

/**
 * What a new machine is told about itself, and how.
 *
 * The bootstrap is one bash script fed to the machine over the exec API. Its
 * payload rides at the top as a quoted heredoc, which bash copies byte for
 * byte into a file: nothing in it is ever expanded on a command line, and the
 * only parser it meets is node's JSON.parse inside the script. The machine
 * token and any repository token travel this way exactly once.
 */

export const BOOTSTRAP_SENTINEL = "EXEORA_BOOTSTRAP_OK";
const PAYLOAD_MARK = "__EXEORA_PAYLOAD__";

export interface BootstrapPayload {
  gatewayUrl: string;
  /** Where `install.sh` lives, normally `${gatewayUrl}/linux/install.sh`. */
  installUrl: string;
  cliVersion: string;
  machineToken: string;
  repoUrl: string;
  branch: string;
  /** A ref to start `branch` from when it does not exist on the remote yet. */
  createBranchFrom?: string | undefined;
  credential?: { username: string; secret: string } | undefined;
  cliConfig: CloudCliConfig;
}

export function renderBootstrap(payload: BootstrapPayload): string {
  const json = JSON.stringify(payload);
  if (json.includes(PAYLOAD_MARK)) throw new Error("The payload cannot contain the heredoc mark.");
  return [
    "set -euo pipefail",
    "umask 077",
    'mkdir -p "$HOME/.exeora"',
    `cat > "$HOME/.exeora/payload.json" <<'${PAYLOAD_MARK}'`,
    json,
    PAYLOAD_MARK,
    template,
  ].join("\n");
}

/** Whether a bootstrap run finished: the script prints the sentinel last. */
export function bootstrapSucceeded(result: { output: string; exitCode: number | null }): boolean {
  return result.exitCode === 0 && result.output.trimEnd().endsWith(BOOTSTRAP_SENTINEL);
}

const FATAL_MARK = "EXEORA_BOOTSTRAP_FATAL ";

/**
 * A reason the script gave up for good: a fact about the request, such as a
 * base branch the repository does not have, that no retry will change.
 */
export function bootstrapFatalReason(output: string): string | undefined {
  const line = output.split("\n").find((candidate) => candidate.includes(FATAL_MARK));
  return line?.slice(line.indexOf(FATAL_MARK) + FATAL_MARK.length).trim() || undefined;
}

/**
 * The CLI's config for a machine that serves one workspace.
 *
 * Both a project entry and a workspace entry point at the same checkout, so a
 * call routed by workspace and one routed as the project root resolve to the
 * same directory. Validated against the shared schema before it is written.
 */
export function cliConfigFor(input: {
  gatewayUrl: string;
  deviceId: string;
  project: { id: string; slug: string; name: string };
  workspace: { id: string; slug: string; branch: string };
}): CloudCliConfig {
  const { gatewayUrl, deviceId, project, workspace } = input;
  return CloudCliConfigSchema.parse({
    gatewayUrl,
    deviceId,
    deviceName: `cloud-${project.slug}-${workspace.slug}`,
    projects: [
      { id: project.id, slug: project.slug, name: project.name, root: CLOUD_WORKSPACE_ROOT },
    ],
    workspaces: [
      {
        id: workspace.id,
        projectId: project.id,
        slug: workspace.slug,
        name: workspace.slug,
        branch: workspace.branch,
        gitRoot: CLOUD_WORKSPACE_ROOT,
        root: CLOUD_WORKSPACE_ROOT,
        managed: true,
        syncState: "active",
      },
    ],
    workspaceRoot: "/home/sprite/workspaces",
  });
}

/** The service the runtime keeps alive inside the machine. */
export function serviceSpecFor(gatewayUrl: string): SpriteServiceSpec {
  return {
    cmd: "/bin/bash",
    args: ["/home/sprite/.exeora/run.sh"],
    needs: [],
    env: {
      HOME: "/home/sprite",
      USER: "sprite",
      SHELL: "/bin/bash",
      LANG: "C.UTF-8",
      PATH: "/home/sprite/.local/bin:/.sprite/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      EXEORA_GATEWAY_URL: gatewayUrl,
      EXEORA_CLOUD: "1",
      EXEORA_MACHINE_TOKEN_FILE: "/home/sprite/.config/exeora/machine-token",
      EXEORA_CGROUP_ROOT: "/sys/fs/cgroup/exeora",
    },
    dir: "/home/sprite",
    http_port: CLOUD_WAKE_PORT,
  };
}

import { z } from "zod";

/**
 * The contract between the gateway and an executor that runs unattended inside
 * an Exeora Cloud workspace: a Fly Sprite microVM with the CLI as a service.
 *
 * Nothing here changes the relay wire format. A cloud executor is an ordinary
 * executor that announces `CLOUD_FEATURE`, and the gateway treats that as two
 * facts: the machine sleeps when idle and has to be woken over HTTP before a
 * call is dispatched, and the workspace lifecycle tools are answered by the
 * gateway (which creates and destroys machines) rather than by the CLI.
 */

/** Announced in `hello.capabilities.features` by an executor in cloud mode. */
export const CLOUD_FEATURE = "cloud-v1";

/**
 * The first CLI release with `connect --cloud`. The bootstrap installs the
 * release the gateway announces as latest, so a gateway still announcing an
 * older one would build machines whose CLI cannot start; provisioning refuses
 * before that. Bump alongside the release that ships cloud mode.
 */
export const CLOUD_MIN_CLI_VERSION = "0.17.0";

/** Whether a CLI release, by version, can run as a cloud machine's service. */
export function cliSupportsCloud(version: string | undefined): boolean {
  if (!version) return false;
  const parse = (value: string) =>
    value
      .split("-")[0]
      ?.split(".")
      .map((part) => Number.parseInt(part, 10)) ?? [];
  const have = parse(version);
  const need = parse(CLOUD_MIN_CLI_VERSION);
  if (have.length !== 3 || have.some((part) => Number.isNaN(part))) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = have[index] ?? 0;
    const b = need[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * The loopback port the CLI listens on inside the machine. The Sprite proxy
 * routes inbound requests to the service registered with this `http_port`, so
 * the gateway wakes a machine by fetching its URL and the request lands here.
 */
export const CLOUD_WAKE_PORT = 8080;

/**
 * Answers 200 only once the relay socket is connected and acknowledged, and
 * 503 while it is still connecting. That distinction is what lets the gateway
 * dispatch right after a wake instead of racing the reconnect.
 */
export const CLOUD_WAKE_PATH = "/wake";

/**
 * How long the CLI keeps the machine awake after the last piece of work, by
 * refreshing a Sprite task with this expiry. Long enough that an agent waiting
 * on a model reply does not pay a wake on every turn; short enough that an
 * abandoned session stops billing within minutes.
 */
export const CLOUD_TASK_HOLD_MS = 180_000;

/** Where every cloud machine keeps its one checkout. */
export const CLOUD_WORKSPACE_ROOT = "/home/sprite/workspace";

/** The slug of the machine that also serves the project root. */
export const CLOUD_MAIN_WORKSPACE_SLUG = "main";

export const CLOUD_MACHINE_STATUSES = ["creating", "ready", "error", "destroying"] as const;

export type CloudMachineStatus = (typeof CLOUD_MACHINE_STATUSES)[number];

/**
 * A workspace's cloud state as the account tools report it. Absent for a
 * workspace on a machine the user runs themselves.
 */
export const CloudWorkspaceState = z.object({
  status: z.enum(CLOUD_MACHINE_STATUSES),
  /** Why provisioning stopped, when `status` is `error`. */
  error: z.string().nullable().optional(),
});

/**
 * The CLI's own `config.json`, as the bootstrap writes it into a machine.
 *
 * Mirrors `ConfigData` in `crates/exeora-cli/src/config.rs` field for field so
 * the file is a checked contract rather than a string template: the CLI reads
 * it at start-up and, in cloud mode, never rewrites it. `star` is left out
 * because the CLI defaults it.
 */
export const CloudCliConfig = z.object({
  gatewayUrl: z.string().url(),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  projects: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      name: z.string().min(1),
      root: z.string().min(1),
    }),
  ),
  workspaces: z.array(
    z.object({
      id: z.string().min(1),
      projectId: z.string().min(1),
      slug: z.string().min(1),
      name: z.string().min(1),
      branch: z.string().nullable(),
      gitRoot: z.string().min(1),
      root: z.string().min(1),
      managed: z.boolean(),
      syncState: z.enum(["pendingUpsert", "active", "pendingDelete", "disabled", "removing"]),
    }),
  ),
  workspaceRoot: z.string().min(1),
});

export type CloudCliConfig = z.infer<typeof CloudCliConfig>;

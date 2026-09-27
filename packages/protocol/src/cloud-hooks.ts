import { z } from "zod";

/**
 * The two scripts a project may run inside its instances on Exeora Cloud.
 *
 * `install` prepares a checkout once: dependencies, a database, whatever the
 * repository needs before anybody can work in it. `resume` puts back what a
 * sleep took away, and runs every time the instance comes back.
 *
 * Each can be written in two places, the project's page and the repository
 * itself, and the page wins: a script written there replaces the file of the
 * same hook. The CLI inside the instance is what runs them, so it is told the
 * page's scripts each time it says hello, which is every time the instance
 * resumes. That is how an edit reaches an instance that already exists.
 */

/** Announced in `hello.capabilities.features` by a CLI that runs the scripts. */
export const CLOUD_HOOKS_FEATURE = "cloud-hooks-v1";

/** The first CLI release that runs them, and that `gh` is signed in on. */
export const CLOUD_HOOKS_MIN_CLI_VERSION = "0.19.0";

export const CLOUD_HOOKS = ["install", "resume"] as const;
export type CloudHook = (typeof CLOUD_HOOKS)[number];

/** Where each script is looked for in the repository, from the checkout's root. */
export const CLOUD_HOOK_FILES: Record<CloudHook, string> = {
  install: ".exeora/cloud_install.sh",
  resume: ".exeora/cloud_resume.sh",
};

/** Largest script the project's page takes, in bytes. */
export const MAX_CLOUD_SCRIPT_BYTES = 16_384;

/** Long, because installing dependencies is: a cold `npm ci` is minutes. */
export const CLOUD_INSTALL_TIMEOUT_MS = 1_200_000;

/** Short, because it runs in front of somebody's first command. */
export const CLOUD_RESUME_TIMEOUT_MS = 120_000;

/**
 * How long a command waits for a script that is running before it goes ahead
 * regardless. A client gives up on a call after about a minute and waking the
 * instance has already spent part of it, so this cannot be the script's own
 * limit: past it the script goes on and the command runs beside it.
 */
export const CLOUD_HOOK_GATE_MS = 30_000;

/** How much of a script's output is kept, from its end, in bytes. */
export const CLOUD_HOOK_OUTPUT_BYTES = 8_000;

export const CLOUD_HOOK_STATUSES = ["running", "ok", "failed", "timed_out", "skipped"] as const;
export type CloudHookStatus = (typeof CLOUD_HOOK_STATUSES)[number];

/** One run of a script, as the instance reports it and the dashboard shows it. */
export const CloudHookRun = z.object({
  /** Made by the instance, so the same run reported twice is one run. */
  runId: z.string().min(1).max(64),
  status: z.enum(CLOUD_HOOK_STATUSES),
  /** Which of the two places the script came from. `none` when there is no script. */
  source: z.enum(["dashboard", "repository", "none"]),
  /**
   * Why it ran: the instance was being set up, the script had changed, a
   * person asked, or the instance came back from a sleep that ended its
   * processes (`cold`) or from one that froze them (`warm`).
   */
  trigger: z.enum(["setup", "changed", "manual", "cold", "warm"]),
  scriptSha256: z.string().length(64).nullable(),
  exitCode: z.number().int().nullable(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  /** The end of what the script printed. Sent only once the run is over. */
  output: z
    .string()
    .max(CLOUD_HOOK_OUTPUT_BYTES * 2)
    .optional(),
  truncated: z.boolean().default(false),
});
export type CloudHookRun = z.infer<typeof CloudHookRun>;

const script = z.string().max(MAX_CLOUD_SCRIPT_BYTES).nullable();

/**
 * What the gateway tells an instance about its project's scripts.
 *
 * `scripts` is null when the gateway could not read them, which is not the
 * same as there being none: the instance then goes by the copy it kept from
 * last time, rather than falling back to the repository's files as if the
 * page were empty.
 */
export const CloudHooksConfig = z.object({
  scripts: z.object({ install: script, resume: script }).nullable(),
  /** Whether the files in the repository may run where the page has no script. */
  repository: z.boolean().default(true),
});
export type CloudHooksConfig = z.infer<typeof CloudHooksConfig>;

/** Instance to gateway: a run began, or ended. */
export const CloudHookStateMessage = z.object({
  type: z.literal("cloud.hook.state"),
  hook: z.enum(CLOUD_HOOKS),
  run: CloudHookRun,
});
export type CloudHookStateMessage = z.infer<typeof CloudHookStateMessage>;

/** Gateway to instance: a person asked for a script to run again. */
export const CloudHookRunMessage = z.object({
  type: z.literal("cloud.hook.run"),
  hook: z.enum(CLOUD_HOOKS),
  config: CloudHooksConfig,
});
export type CloudHookRunMessage = z.infer<typeof CloudHookRunMessage>;

import {
  CLOUD_HOOK_OUTPUT_BYTES,
  CLOUD_HOOKS_MIN_CLI_VERSION,
  type CloudHook,
  CloudHookRun,
  type CloudHooksConfig,
  cliAtLeast,
  MAX_CLOUD_SCRIPT_BYTES,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";

/**
 * The scripts of a project, and what became of them on each instance.
 *
 * Two halves that never meet in one row. What a person wrote on the project's
 * page is the project's, and is sent to an instance every time it says hello.
 * What an instance did with it is the instance's, reported over its own
 * socket, and is what the dashboard shows beside that instance.
 *
 * A script is not a secret and is stored as written. It is not a tool call
 * either, so nothing here reaches the audit trail, which records calls.
 */

export interface CloudScripts {
  install: string | null;
  resume: string | null;
  runRepositoryScripts: boolean;
  updatedAt: number | null;
}

export type ScriptRefusal =
  | { error: "script_too_large"; hook: CloudHook; max: number }
  | { error: "invalid_script"; hook: CloudHook; message: string };

const NONE: CloudScripts = {
  install: null,
  resume: null,
  runRepositoryScripts: true,
  updatedAt: null,
};

/**
 * A script as it is kept: with the line endings a shell reads, and nothing
 * at all when it says nothing. An empty field is how a person says "use the
 * file in the repository", so whitespace alone must not count as a script.
 */
export function cleanScript(hook: CloudHook, text: string | null): string | null | ScriptRefusal {
  if (text === null) return null;
  const script = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (script.trim() === "") return null;
  if (script.includes("\0")) {
    return {
      error: "invalid_script",
      hook,
      message: "The script holds a character no shell can read. Paste it again as plain text.",
    };
  }
  // Measured as it is kept, with the line break a script ends in.
  const kept = script.endsWith("\n") ? script : `${script}\n`;
  if (new TextEncoder().encode(kept).length > MAX_CLOUD_SCRIPT_BYTES) {
    return { error: "script_too_large", hook, max: MAX_CLOUD_SCRIPT_BYTES };
  }
  return kept;
}

export async function scriptsOf(env: Pick<Env, "DB">, projectId: string): Promise<CloudScripts> {
  const row = await db(env)
    .select()
    .from(schema.projectCloudScripts)
    .where(eq(schema.projectCloudScripts.projectId, projectId))
    .get();
  if (!row) return NONE;
  return {
    install: row.installScript,
    resume: row.resumeScript,
    runRepositoryScripts: row.runRepositoryScripts,
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Writes what the page holds. Answers null for a project that is not this person's. */
export async function saveScripts(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
  input: {
    install: string | null;
    resume: string | null;
    runRepositoryScripts?: boolean | undefined;
  },
): Promise<CloudScripts | ScriptRefusal | null> {
  const install = cleanScript("install", input.install);
  if (install !== null && typeof install !== "string") return install;
  const resume = cleanScript("resume", input.resume);
  if (resume !== null && typeof resume !== "string") return resume;

  const now = Date.now();
  // Selected out of the project, so a project that is somebody else's, or
  // gone, writes nothing.
  const result = await env.DB.prepare(
    `INSERT INTO project_cloud_scripts
       (project_id, user_id, install_script, resume_script, run_repository_scripts, updated_at)
     SELECT id, user_id, ?3, ?4, ?5, ?6 FROM projects WHERE id = ?1 AND user_id = ?2
     ON CONFLICT (project_id) DO UPDATE SET
       install_script = excluded.install_script,
       resume_script = excluded.resume_script,
       run_repository_scripts = excluded.run_repository_scripts,
       updated_at = excluded.updated_at`,
  )
    .bind(projectId, userId, install, resume, (input.runRepositoryScripts ?? true) ? 1 : 0, now)
    .run();
  if ((result.meta.changes ?? 0) === 0) return null;
  return scriptsOf(env, projectId);
}

/**
 * What an instance is told when it says hello. Undefined for a machine that
 * is not an instance of Exeora Cloud, which is told nothing.
 *
 * A database that could not be read is told as such, with `scripts: null`,
 * and the instance goes by what it was told last time. Answering "no scripts"
 * instead would send it to the repository's files, which the page may have
 * been written to replace.
 */
export async function hooksConfigFor(
  env: Pick<Env, "DB">,
  deviceId: string,
): Promise<CloudHooksConfig | undefined> {
  try {
    const machine = await db(env)
      .select({ projectId: schema.cloudMachines.projectId })
      .from(schema.cloudMachines)
      .where(eq(schema.cloudMachines.deviceId, deviceId))
      .get();
    if (!machine) return undefined;
    const scripts = await scriptsOf(env, machine.projectId);
    return {
      scripts: { install: scripts.install, resume: scripts.resume },
      repository: scripts.runRepositoryScripts,
    };
  } catch (error) {
    console.error("could not read the scripts of a cloud project", error);
    return { scripts: null, repository: true };
  }
}

const COLUMN = { install: "install_hook", resume: "resume_hook" } as const;

/** A run as it was stored, or null for none and for anything unreadable. */
export function hookRunOf(stored: string | null): CloudHookRun | null {
  if (!stored) return null;
  try {
    const parsed = CloudHookRun.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Keeps what an instance said about a run.
 *
 * Frames can arrive out of order, and an instance says its last word again
 * each time it reconnects, so an older run never replaces a newer one, and
 * the end of a run never gives way to its beginning.
 */
export async function recordHookState(
  env: Pick<Env, "DB">,
  deviceId: string,
  hook: CloudHook,
  run: CloudHookRun,
): Promise<boolean> {
  const column = COLUMN[hook];
  const output = run.output === undefined ? undefined : lastBytes(run.output);
  const kept: CloudHookRun = {
    ...run,
    ...(output === undefined
      ? {}
      : { output: output.text, truncated: run.truncated || output.cut }),
  };
  // Decided where it is written, in one statement: two frames of one run
  // arrive a moment apart, and read first and written after, the beginning
  // could land on top of the end and leave the run running for ever.
  const written = await env.DB.prepare(
    `UPDATE cloud_machines
        SET ${column} = ?2, updated_at = unixepoch() * 1000
      WHERE device_id = ?1
        AND (
          ${column} IS NULL
          OR json_extract(${column}, '$.startedAt') < ?3
          OR (
            json_extract(${column}, '$.startedAt') = ?3
            AND (?4 != 'running' OR json_extract(${column}, '$.status') = 'running')
          )
        )`,
  )
    .bind(deviceId, JSON.stringify(kept), run.startedAt, run.status)
    .run();
  return (written.meta.changes ?? 0) > 0;
}

/** The end of a text, by bytes, never cutting a character in two. */
function lastBytes(text: string): { text: string; cut: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= CLOUD_HOOK_OUTPUT_BYTES) return { text, cut: false };
  const decoded = new TextDecoder().decode(bytes.slice(bytes.length - CLOUD_HOOK_OUTPUT_BYTES));
  return { text: decoded.replace(/^�+/, ""), cut: true };
}

export interface HooksView {
  /** False for an instance whose CLI is older than the scripts. Nothing runs there. */
  supported: boolean;
  install: CloudHookRun | null;
  resume: CloudHookRun | null;
}

/**
 * The runs as a page shows them. What a script printed is kept to the runs
 * that went wrong, which is when somebody reads it: a list of machines is
 * polled every few seconds, and the output of every run that went well would
 * be most of what it carried.
 */
export function hooksView(
  env: Pick<Env, "LATEST_CLI_VERSION">,
  machine: { installHook: string | null; resumeHook: string | null },
  cliVersion: string | null,
): HooksView {
  const shown = (stored: string | null) => {
    const run = hookRunOf(stored);
    if (!run) return null;
    if (run.status === "failed" || run.status === "timed_out") return run;
    const { output: _output, ...rest } = run;
    return rest;
  };
  return {
    // A machine that has not connected yet carries the CLI it was made with.
    supported: cliAtLeast(cliVersion ?? env.LATEST_CLI_VERSION, CLOUD_HOOKS_MIN_CLI_VERSION),
    install: shown(machine.installHook),
    resume: shown(machine.resumeHook),
  };
}

/** Whether a run is over, whichever way it went. */
export function settled(run: CloudHookRun | null): boolean {
  return run !== null && run.status !== "running";
}

/** The machine a person named, when it is an instance of theirs. */
export async function ownedInstance(env: Pick<Env, "DB">, userId: string, deviceId: string) {
  return db(env)
    .select({ deviceId: schema.cloudMachines.deviceId, status: schema.cloudMachines.status })
    .from(schema.cloudMachines)
    .where(
      and(eq(schema.cloudMachines.deviceId, deviceId), eq(schema.cloudMachines.userId, userId)),
    )
    .get();
}

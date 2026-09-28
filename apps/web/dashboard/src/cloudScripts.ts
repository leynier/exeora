import { ApiError, errorText } from "./api.js";
import type { CloudHook, CloudScripts, CloudScriptsInput, Project, User } from "./api-types.js";
import { cloudLocation } from "./projectModel.js";
import { hasRepository } from "./survival.js";

/**
 * The scripts of a project as its page writes them: what each field will do
 * once saved, how large it is, and what to say when the gateway refuses it.
 *
 * Without React, so the sentences can be tested one combination at a time.
 * They are the part of this screen that has to be true: a person decides
 * whether a file in the repository runs by reading them.
 */

export const HOOKS = ["install", "resume"] as const satisfies readonly CloudHook[];

/** Largest script the gateway takes, in bytes. Restated from `@exeora/protocol`. */
export const MAX_SCRIPT_BYTES = 16_384;

/** From where the counter is worth showing: three quarters of the way there. */
const NEAR_THE_LIMIT = MAX_SCRIPT_BYTES * 0.75;

/** Where each script is looked for in the repository. Restated from `@exeora/protocol`. */
export const HOOK_FILES: Record<CloudHook, string> = {
  install: ".exeora/cloud_install.sh",
  resume: ".exeora/cloud_resume.sh",
};

export const HOOK_LABELS: Record<CloudHook, string> = {
  install: "Cloud Install script",
  resume: "Cloud Resume script",
};

export const HOOK_HELP: Record<CloudHook, string> = {
  install: "Runs once when an instance is set up, and again when the script changes.",
  resume: "Runs every time an instance resumes. Keep it short and safe to run twice.",
};

/** What the form holds: a field is a string even when it is empty. */
export interface ScriptsDraft {
  install: string;
  resume: string;
  runRepositoryScripts: boolean;
}

export function draftOf(scripts: CloudScripts): ScriptsDraft {
  return {
    install: scripts.install ?? "",
    resume: scripts.resume ?? "",
    runRepositoryScripts: scripts.runRepositoryScripts,
  };
}

/**
 * A field as the gateway keeps it: nothing at all when it says nothing.
 * Spaces alone are not a script, and must not switch the repository's file
 * off by looking like one.
 */
export function storedScript(text: string): string | null {
  return text.trim() === "" ? null : text;
}

export function inputOf(draft: ScriptsDraft): CloudScriptsInput {
  return {
    install: storedScript(draft.install),
    resume: storedScript(draft.resume),
    runRepositoryScripts: draft.runRepositoryScripts,
  };
}

/** Whether saving would change anything. A field of spaces is an empty one. */
export function scriptsChanged(draft: ScriptsDraft, saved: CloudScripts): boolean {
  const next = inputOf(draft);
  return (
    next.install !== saved.install ||
    next.resume !== saved.resume ||
    next.runRepositoryScripts !== saved.runRepositoryScripts
  );
}

/**
 * Which script runs for a hook, said for what is in the field right now.
 *
 * The page replaces the repository, so text in the field is the whole answer
 * whatever the switch says. An empty field leaves it to the file, and to the
 * switch that can turn the files off.
 */
export function precedenceLine(
  hook: CloudHook,
  text: string,
  runRepositoryScripts: boolean,
): string {
  if (storedScript(text) !== null) return `Replaces ${HOOK_FILES[hook]} from the repository.`;
  return runRepositoryScripts
    ? `Empty: ${HOOK_FILES[hook]} from the repository runs when it exists.`
    : "Empty: nothing runs.";
}

/** How large a script is as it is sent, which is in bytes of UTF-8 and not in characters. */
export function scriptBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A count with its thousands apart, the way the limit is written: `16 384`. */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** How much of the limit a script takes, once it is close enough to matter. */
export function counterLine(text: string): string | null {
  const bytes = scriptBytes(text);
  if (bytes < NEAR_THE_LIMIT) return null;
  return `${formatCount(bytes)} of ${formatCount(MAX_SCRIPT_BYTES)} bytes`;
}

/** Why a script cannot be saved as it is, or null when it can. */
export function sizeProblem(hook: CloudHook, text: string): string | null {
  const bytes = scriptBytes(text);
  if (bytes <= MAX_SCRIPT_BYTES) return null;
  return `The ${hook} script is ${formatCount(bytes)} bytes, and the limit is ${formatCount(MAX_SCRIPT_BYTES)}. Shorten it to save.`;
}

/**
 * Whether the project's page has anything to say about scripts.
 *
 * They run on Exeora Cloud and nowhere else, so the card is for an account
 * that has Cloud or a project that is on it. A directory with no repository
 * can never be there: Cloud has nothing to run but a clone.
 */
export function showsCloudScripts(
  project: Pick<Project, "repoUrl" | "cloud" | "locations">,
  user: Pick<User, "cloudEnabled"> | undefined,
): boolean {
  if (!hasRepository(project)) return false;
  return user?.cloudEnabled === true || project.cloud !== null || cloudLocation(project) !== null;
}

/** A refusal to save: the sentence, and the field it is about when it is about one. */
export interface SaveRefusal {
  hook: CloudHook | null;
  message: string;
}

function hookOf(body: Record<string, unknown> | null): CloudHook | null {
  return body?.hook === "install" || body?.hook === "resume" ? body.hook : null;
}

/** What to say when the gateway would not save, as the cause and what to do. */
export function saveRefusal(error: unknown): SaveRefusal {
  if (error instanceof ApiError) {
    const hook = hookOf(error.body);
    const name = hook ? `The ${hook} script` : "A script";
    if (error.code === "script_too_large") {
      const max = typeof error.body?.max === "number" ? error.body.max : MAX_SCRIPT_BYTES;
      return {
        hook,
        message: `${name} is larger than ${formatCount(max)} bytes. Shorten it, then save again.`,
      };
    }
    if (error.code === "invalid_script") {
      const said = typeof error.body?.message === "string" ? ` ${error.sentence}` : "";
      return { hook, message: `${name} was not saved.${said}` };
    }
    if (error.code === "not_found") {
      return {
        hook: null,
        message: "This project no longer exists, so the scripts were not saved. Reload the page.",
      };
    }
  }
  return {
    hook: null,
    message: `The scripts were not saved. ${errorText(error, "Try again in a moment.")}`,
  };
}

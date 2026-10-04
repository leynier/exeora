import { failureText, type PanelSelection, readAnswer } from "./selection.js";
import { answerText, type CallTool, type ToolAnswer } from "./transport.js";

/**
 * Turns how the panel was opened into the place it shows.
 *
 * The host calls the entrypoint tool itself and hands its arguments and result
 * to the panel, which uses that result rather than calling again. A file
 * opened from a thread is the one case that needs a second call: only a call
 * the panel makes is amended by the host with the file's real path, which the
 * gateway needs to find the project it belongs to. A retry calls afresh.
 */

export const OPEN_PANEL_TOOL = "exeora_open_panel";
export const RESOLVE_FILE_TOOL = "exeora_resolve_file";

export interface FileInput {
  name: string;
  resourceUri: string;
}

export interface Invocation {
  /** The entrypoint tool's arguments, from `ui/notifications/tool-input`. */
  input: Record<string, unknown> | null;
  /** Its result, from `ui/notifications/tool-result`, unless a retry wants a fresh one. */
  result: ToolAnswer | null;
  /** Whether the host amends the panel's calls with an opened file's path. */
  fileAccess: boolean;
}

/**
 * ChatGPT hands a file's path to the server on desktop only; on the web and
 * on phones there is nothing for the gateway to find the file by.
 */
export const FILES_DESKTOP_ONLY =
  "Opening a file from a thread works in the ChatGPT desktop app. Here, choose a workspace and open the file from its Explorer.";

export type Opening =
  | { kind: "ready"; selection: PanelSelection; file: FileInput | null }
  | { kind: "failed"; message: string; file: FileInput | null };

export async function resolveOpening(invocation: Invocation, call: CallTool): Promise<Opening> {
  const file = fileInput(invocation.input);
  const opening = await openFrom(invocation, file, call);
  // The gateway's own sentence about a missing path means little to someone
  // on a host that never sends one.
  if (opening.kind === "failed" && file && !invocation.fileAccess) {
    return { ...opening, message: FILES_DESKTOP_ONLY };
  }
  return opening;
}

async function openFrom(
  invocation: Invocation,
  file: FileInput | null,
  call: CallTool,
): Promise<Opening> {
  if (invocation.result) {
    const opened = settle(invocation.result, file);
    if (opened) return opened;
  }
  const answer = file
    ? await call(RESOLVE_FILE_TOOL, { file, ...place(invocation.input) })
    : await call(OPEN_PANEL_TOOL, { ...place(invocation.input), ...pathOf(invocation.input) });
  return settle(answer, file) ?? { kind: "failed", message: failureText("error"), file };
}

/** A result the panel can show, or null when it has to ask the gateway itself. */
function settle(answer: ToolAnswer, file: FileInput | null): Opening | null {
  if (answer.isError) {
    return { kind: "failed", message: answerText(answer) || failureText("error"), file };
  }
  const read = readAnswer(answer.structuredContent);
  if (!read || read.kind === "resolve") return null;
  if (read.kind === "failed") return { kind: "failed", message: read.message, file };
  return { kind: "ready", selection: read.selection, file };
}

export function fileInput(input: Record<string, unknown> | null): FileInput | null {
  const file = input?.file;
  if (typeof file !== "object" || file === null) return null;
  const { name, resourceUri } = file as Record<string, unknown>;
  if (typeof name !== "string" || typeof resourceUri !== "string") return null;
  if (name.trim() === "" || resourceUri.trim() === "") return null;
  return { name, resourceUri };
}

function place(input: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input?.project === "string" && input.project) out.project = input.project;
  if (typeof input?.workspace === "string" && input.workspace) out.workspace = input.workspace;
  return out;
}

function pathOf(input: Record<string, unknown> | null): Record<string, string> {
  return typeof input?.path === "string" && input.path ? { path: input.path } : {};
}

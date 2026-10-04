import { WORKSPACE_VIEWS } from "../components/workspace/workspaceLayout.js";
import type { NavigateArgs, PanelController, PanelState } from "./controller.js";
import type { ToolAnswer } from "./transport.js";

/**
 * The tools this panel offers ChatGPT itself (MCP Apps app tools): they act
 * on this open panel, not on the server. Their answers describe places,
 * names and states, never a file's contents or any credential.
 */

export const GET_STATE_TOOL = "exeora_workspace_get_state";
export const NAVIGATE_TOOL = "exeora_workspace_navigate";

const SEARCH_SCHEMA = {
  type: "object",
  description: "Run a search in the Search view. Fields left out keep their current value.",
  properties: {
    query: { type: "string", maxLength: 1000, description: "Empty clears the search." },
    regex: { type: "boolean" },
    caseSensitive: { type: "boolean" },
    wholeWord: { type: "boolean" },
    include: { type: "string", maxLength: 1000, description: "Glob of files to search." },
    exclude: { type: "string", maxLength: 1000, description: "Glob of files to skip." },
    includeIgnored: { type: "boolean", description: "Also search ignored files." },
  },
  additionalProperties: false,
};

export const APP_TOOLS = [
  {
    name: GET_STATE_TOOL,
    title: "Get Workspace state",
    description:
      "What this Exeora Workspace panel shows: project, workspace, view, the file or diff in front, open and unsaved file paths, the search, and any change waiting for the person to confirm. Never file contents.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: NAVIGATE_TOOL,
    title: "Navigate Workspace",
    description:
      "Move this open Exeora Workspace panel: another project or workspace, a view, a file, a diff, or a search. Give at most one of path, diff or search; anything left out stays as it is. Leaving a workspace with unsaved edits waits for the person to confirm (status needs_confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project id or slug." },
        workspace: { type: "string", description: "Workspace selector in the project." },
        tab: { type: "string", enum: [...WORKSPACE_VIEWS] },
        path: { type: "string", description: "File to open, relative to the workspace." },
        diff: {
          type: "object",
          properties: {
            path: { type: "string" },
            area: { type: "string", enum: ["working", "staged"] },
          },
          required: ["path"],
          additionalProperties: false,
        },
        search: SEARCH_SCHEMA,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

export async function callAppTool(
  controller: PanelController,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolAnswer> {
  if (name === GET_STATE_TOOL) return stateAnswer(controller.state());
  if (name === NAVIGATE_TOOL) {
    const checked = navigateArgs(args);
    if (typeof checked === "string") {
      return {
        isError: true,
        content: [{ type: "text", text: checked }],
        structuredContent: { status: "error", message: checked, state: controller.state() },
      };
    }
    const result = await controller.navigate(checked);
    const text = result.message ?? NAVIGATED[result.status];
    return {
      ...(result.status === "error" ? { isError: true } : {}),
      content: [{ type: "text", text }],
      structuredContent: {
        status: result.status,
        ...(result.message ? { message: result.message } : {}),
        state: result.state,
      },
    };
  }
  return { isError: true, content: [{ type: "text", text: `No tool named ${name}.` }] };
}

const NAVIGATED = {
  applied: "The Workspace moved there.",
  queued: "The Workspace is still getting there; check again with exeora_workspace_get_state.",
  needs_confirmation:
    "The workspace being left has unsaved edits. The person has been asked to confirm; check again with exeora_workspace_get_state.",
  cancelled: "The person chose to stay.",
  superseded: "A newer navigation replaced this one.",
  error: "The Workspace could not go there.",
} as const;

function stateAnswer(state: PanelState): ToolAnswer {
  const where = state.projectId
    ? `Project ${state.projectId}${state.workspace ? `, workspace ${state.workspace}` : ""}, ${state.tab ?? "default"} view${state.path ? `, ${state.path}` : ""}.`
    : "No project chosen yet.";
  return { content: [{ type: "text", text: where }], structuredContent: { ...state } };
}

const NAVIGATE_FIELDS = new Set(["project", "workspace", "tab", "path", "diff", "search"]);
const DIFF_FIELDS = new Set(["path", "area"]);
const SEARCH_TEXT = new Set(["query", "include", "exclude"]);
const SEARCH_FLAGS = new Set(["regex", "caseSensitive", "wholeWord", "includeIgnored"]);

/**
 * The navigate tool's arguments, checked as its schema says before anything
 * is done with them; a sentence saying what is wrong otherwise. Nothing the
 * schema does not name is dropped quietly: it is refused.
 */
export function navigateArgs(args: unknown): NavigateArgs | string {
  if (args === undefined) return {};
  if (!isRecord(args)) return "Arguments must be an object.";
  const unknown = Object.keys(args).find((key) => !NAVIGATE_FIELDS.has(key));
  if (unknown) return `Unknown field ${unknown}.`;
  const out: NavigateArgs = {};
  for (const [field, max] of [
    ["project", 128],
    ["workspace", 128],
  ] as const) {
    if (args[field] === undefined) continue;
    const value = args[field];
    if (typeof value !== "string" || value.trim() === "" || value.length > max) {
      return `${field} must be a non-empty string of at most ${max} characters.`;
    }
    out[field] = value;
  }
  if (args.tab !== undefined) {
    if (!(WORKSPACE_VIEWS as readonly unknown[]).includes(args.tab)) {
      return `tab must be one of ${WORKSPACE_VIEWS.join(", ")}.`;
    }
    out.tab = args.tab as NavigateArgs["tab"];
  }
  if (args.path !== undefined) {
    const problem = relativePathProblem(args.path, "path");
    if (problem) return problem;
    out.path = args.path as string;
  }
  if (args.diff !== undefined) {
    if (!isRecord(args.diff)) return "diff must be an object.";
    const extra = Object.keys(args.diff).find((key) => !DIFF_FIELDS.has(key));
    if (extra) return `Unknown field diff.${extra}.`;
    const problem = relativePathProblem(args.diff.path, "diff.path");
    if (problem) return problem;
    const area = args.diff.area;
    if (area !== undefined && area !== "working" && area !== "staged") {
      return "diff.area must be working or staged.";
    }
    out.diff = { path: args.diff.path as string, ...(area ? { area } : {}) };
  }
  if (args.search !== undefined) {
    if (!isRecord(args.search)) return "search must be an object.";
    const search: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(args.search)) {
      if (SEARCH_TEXT.has(key)) {
        if (typeof value !== "string" || value.length > 1000) {
          return `search.${key} must be a string of at most 1000 characters.`;
        }
      } else if (SEARCH_FLAGS.has(key)) {
        if (typeof value !== "boolean") return `search.${key} must be true or false.`;
      } else {
        return `Unknown field search.${key}.`;
      }
      search[key] = value;
    }
    out.search = search;
  }
  const targets = [out.path, out.diff, out.search].filter((value) => value !== undefined);
  if (targets.length > 1) return "Give at most one of path, diff or search.";
  const implied = out.path ? "explorer" : out.diff ? "source" : out.search ? "search" : undefined;
  if (implied && out.tab && implied !== out.tab) {
    return `A ${out.path ? "path" : out.diff ? "diff" : "search"} opens in the ${implied} tab, not ${out.tab}.`;
  }
  return out;
}

function relativePathProblem(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim() === "" || value.length > 4096) {
    return `${field} must be a non-empty path of at most 4096 characters.`;
  }
  const parts = value.replaceAll("\\", "/").split("/");
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value) || parts.includes("..")) {
    return `${field} must be relative to the workspace, without "..".`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

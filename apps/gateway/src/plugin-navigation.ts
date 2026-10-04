import { ExeoraError } from "@exeora/protocol";
import { z } from "zod";
import { safeRelativePath } from "./plugin-paths.js";

export const WorkspaceTab = z.enum(["explorer", "search", "source", "pr", "terminal", "logs"]);
export const PanelDiff = z
  .object({
    path: z.string().min(1).max(4096),
    area: z.enum(["working", "staged"]).default("working"),
  })
  .strict();
export const PanelSearch = z
  .object({
    query: z.string().max(1000),
    regex: z.boolean().default(false),
    caseSensitive: z.boolean().default(false),
    wholeWord: z.boolean().default(false),
    include: z.string().max(1000).default(""),
    exclude: z.string().max(1000).default(""),
    includeIgnored: z.boolean().default(false),
  })
  .strict();
export const PanelNavigation = z
  .object({
    project: z.string().min(1).max(128).optional(),
    workspace: z.string().min(1).max(128).optional(),
    tab: WorkspaceTab.optional(),
    path: z.string().min(1).max(4096).optional(),
    diff: PanelDiff.optional(),
    search: PanelSearch.optional(),
  })
  .strict();

export type PanelNavigationInput = z.input<typeof PanelNavigation>;

/** Validate even before showing a project picker; metadata never authorizes a path. */
export function navigationSelection(input: PanelNavigationInput) {
  const parsed = PanelNavigation.safeParse(input);
  if (!parsed.success)
    throw new ExeoraError("INVALID_ARGUMENTS", "Use a supported workspace navigation request.");
  const args = parsed.data;
  const count = [args.path, args.diff, args.search].filter((target) => target !== undefined).length;
  if (count > 1)
    throw new ExeoraError("INVALID_ARGUMENTS", "Choose one file, diff or search per request.");
  const path = args.path ?? args.diff?.path;
  if (path !== undefined && !safeRelativePath(path))
    throw new ExeoraError("INVALID_ARGUMENTS", "Use a path relative to the selected workspace.");
  const inferred = args.path
    ? "explorer"
    : args.diff
      ? "source"
      : args.search
        ? "search"
        : undefined;
  if (inferred && args.tab && inferred !== args.tab)
    throw new ExeoraError("INVALID_ARGUMENTS", "The selected tab does not match its content.");
  return {
    ...((args.tab ?? inferred) ? { tab: args.tab ?? inferred } : {}),
    ...(args.path ? { path: args.path } : {}),
    ...(args.diff ? { diff: args.diff } : {}),
    ...(args.search ? { search: args.search } : {}),
  };
}

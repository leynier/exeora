import { z } from "zod";

/**
 * The three tools that exist only on the account endpoint, `exeora.dev/mcp`.
 *
 * A per-project URL carries its project in the path, so there is nothing here
 * for it to say: naming a project would be the one thing that endpoint refuses
 * to let an agent do. These answer entirely inside the gateway and never reach
 * a machine, which is why they are a registry of their own rather than three
 * more entries in `TOOL_DEFINITIONS`. That separation is load-bearing in three
 * places: the executor announces `TOOL_NAMES` and can run none of these, the
 * command policy is defined over `ToolName` and none of these run a command,
 * and the tool reference is generated per registry so the page can say where
 * each one exists.
 */

export const ProjectRef = z
  .string()
  .min(1)
  .describe("The project's slug, or its id. Slugs are unique within an account.");

export const ProjectSummary = z.object({
  slug: z.string(),
  name: z.string(),
  /** The machine serving it, by name. Never its path on disk. */
  machine: z.string(),
  /** Whether that machine has checked in recently enough to answer a call. */
  online: z.boolean(),
  /** True for the one this client is currently working in. */
  active: z.boolean(),
});

export const ListProjectsInput = z.object({});

export const ListProjectsOutput = z.object({
  projects: z.array(ProjectSummary),
  /**
   * The slug of the active project, or null when none is selected. Duplicated
   * from the `active` flag on purpose: it is the answer to the question the
   * caller usually has, and reading it should not mean scanning the list.
   */
  activeProject: z.string().nullable(),
});

export const GetActiveProjectInput = z.object({});

export const GetActiveProjectOutput = z.object({
  project: ProjectSummary.nullable(),
});

export const SetActiveProjectInput = z.object({ project: ProjectRef });

export const SetActiveProjectOutput = z.object({
  project: ProjectSummary,
});

export const ACCOUNT_TOOL_DEFINITIONS = {
  list_projects: {
    title: "List projects",
    description:
      "List the projects this connection can reach, and say which one is active. The active " +
      "project is where every other tool runs unless a call names another one.",
    inputSchema: ListProjectsInput,
    outputSchema: ListProjectsOutput,
    readOnly: true,
  },
  get_active_project: {
    title: "Get the active project",
    description:
      "The project every other tool works in right now, or null when none is selected. Use " +
      "list_projects to see what else is available.",
    inputSchema: GetActiveProjectInput,
    outputSchema: GetActiveProjectOutput,
    readOnly: true,
  },
  set_active_project: {
    title: "Switch the active project",
    description:
      "Choose the project every other tool works in from now on, by slug or id. The choice " +
      "belongs to this client rather than to a conversation, so it outlives this one and is " +
      "shared with any other conversation open in the same client. To work somewhere else for a " +
      "single call without moving it, pass that call a project argument instead.",
    inputSchema: SetActiveProjectInput,
    outputSchema: SetActiveProjectOutput,
    // It changes which project the next call lands in, and nothing on any
    // machine. Marked as changing something all the same: a client that hides
    // non-read-only tools should hide the one that moves the target.
    readOnly: false,
  },
} as const;

export type AccountToolName = keyof typeof ACCOUNT_TOOL_DEFINITIONS;

export const ACCOUNT_TOOL_NAMES = Object.keys(ACCOUNT_TOOL_DEFINITIONS) as AccountToolName[];

export function isAccountToolName(value: unknown): value is AccountToolName {
  return typeof value === "string" && value in ACCOUNT_TOOL_DEFINITIONS;
}

export type AccountToolInput<N extends AccountToolName> = z.infer<
  (typeof ACCOUNT_TOOL_DEFINITIONS)[N]["inputSchema"]
>;
export type AccountToolOutput<N extends AccountToolName> = z.infer<
  (typeof ACCOUNT_TOOL_DEFINITIONS)[N]["outputSchema"]
>;

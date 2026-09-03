import { z } from "zod";

/**
 * The tools that exist only on the account endpoint, `exeora.dev/mcp`.
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

export const WorkspaceRef = z
  .string()
  .min(1)
  .describe(
    "A connected workspace's slug or stable id. Use main, or omit it, for the project root.",
  );

export const ProjectSummary = z.object({
  slug: z.string(),
  name: z.string(),
  /** The machine serving it, by name. Never its path on disk. */
  machine: z.string(),
  /** Whether that machine has checked in recently enough to answer a call. */
  online: z.boolean(),
});

export const ListProjectsInput = z.object({});

export const ListProjectsOutput = z.object({
  projects: z.array(ProjectSummary),
});

export const ListWorkspacesInput = z.object({ project: ProjectRef.optional() });

export const ListWorkspacesOutput = z.object({
  project: z.string(),
  workspaces: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      branch: z.string().nullable(),
      managed: z.boolean(),
    }),
  ),
});

export const ACCOUNT_TOOL_DEFINITIONS = {
  list_workspaces: {
    title: "List workspaces",
    description:
      "List the Git workspaces connected under a project. Pass a project slug or id when this connection reaches more than one project.",
    inputSchema: ListWorkspacesInput,
    outputSchema: ListWorkspacesOutput,
    readOnly: true,
  },
  list_projects: {
    title: "List projects",
    description:
      "List the projects this connection can reach. When more than one is listed, every other " +
      "tool call must name its project by slug or id.",
    inputSchema: ListProjectsInput,
    outputSchema: ListProjectsOutput,
    readOnly: true,
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

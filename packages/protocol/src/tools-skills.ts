import { z } from "zod";

export const ListSkillsInput = z.object({});

export const ListSkillsOutput = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      source: z.enum(["project", "user"]),
      path: z.string().describe("Path to pass to read_file."),
    }),
  ),
});

export const SKILL_TOOL_DEFINITIONS = {
  list_skills: {
    title: "List agent skills",
    description:
      "List Agent Skills available on this machine: `~/.agents/skills/` and `.agents/skills/` in " +
      "the project. Returns name, description, source and the path to pass to read_file. Call once " +
      "near the start of a session; when a description matches the task, read_file that path and " +
      "follow it. Project skills override user skills with the same name.",
    inputSchema: ListSkillsInput,
    outputSchema: ListSkillsOutput,
    readOnly: true,
  },
} as const;

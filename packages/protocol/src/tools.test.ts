import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, TOOL_NAMES, toolFields, toolInputSchema } from "./tools.js";

/**
 * The contract as the documentation reads it.
 *
 * The tool reference on the site is generated from these definitions, so what
 * is asserted here is what gets published: a tool with no description, or an
 * argument with none, becomes an empty cell on a page rather than a compile
 * error anywhere.
 */

describe("toolFields", () => {
  it("describes every argument of every tool", () => {
    for (const name of TOOL_NAMES) {
      for (const field of toolFields(name)) {
        expect(field.description, `${name}.${field.name} has no description`).not.toBe("");
        expect(field.type, `${name}.${field.name} has no type`).not.toBe("unknown");
      }
    }
  });

  it("knows which arguments are required", () => {
    const fields = toolFields("read_file");

    expect(fields.find((field) => field.name === "path")?.required).toBe(true);
    expect(fields.find((field) => field.name === "offset")?.required).toBe(false);
  });

  it("carries the wording the agent itself is given", () => {
    // Not a paraphrase: the description an agent reads and the one on the site
    // are the same string, which is the only way they cannot disagree.
    const command = toolFields("run_command").find((field) => field.name === "command");
    expect(command?.description).toContain("Shell command");
  });
});

describe("tool definitions", () => {
  it("gives every tool a title and a description", () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_DEFINITIONS[name].title.length, `${name} has no title`).toBeGreaterThan(0);
      expect(
        TOOL_DEFINITIONS[name].description.length,
        `${name} has no description`,
      ).toBeGreaterThan(20);
    }
  });

  it("marks exactly the tools that change nothing as read only", () => {
    const readOnly = TOOL_NAMES.filter((name) => TOOL_DEFINITIONS[name].readOnly);

    // Spelled out rather than derived, because this list decides two things
    // that matter: what survives `read_only` mode, and what is never
    // interrupted by a confirmation prompt.
    expect(readOnly).toEqual([
      "read_file",
      "list_files",
      "grep",
      "list_git_worktrees",
      "get_command_output",
      "list_skills",
    ]);
  });

  it("validates worktree lifecycle combinations", () => {
    expect(
      toolInputSchema("create_worktree").safeParse({
        branch: "feature/api",
        from: "main",
        reuseExistingBranch: true,
      }).success,
    ).toBe(false);
    expect(toolInputSchema("attach_worktree").safeParse({ branch: "feature/api" }).success).toBe(
      true,
    );
    expect(toolInputSchema("attach_worktree").safeParse({}).success).toBe(false);
    expect(
      toolInputSchema("attach_worktree").safeParse({
        path: "/work/feature-api",
        branch: "feature/api",
      }).success,
    ).toBe(false);
  });

  it("treats apply_patch as a mutating batch, not a read", () => {
    expect(TOOL_DEFINITIONS.apply_patch.readOnly).toBe(false);
    expect(toolFields("apply_patch").find((field) => field.name === "operations")?.required).toBe(
      true,
    );
  });
});

import { TOOL_DEFINITIONS, type ToolName, WorktreeRef } from "@exeora/protocol";
import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";

const worktreeRouting = {
  worktree: WorktreeRef.optional().describe(
    "Run this call in a connected Git worktree by slug or id. Omit it, or use main, for the project root.",
  ),
};
const requiredWorktreeRouting = {
  worktree: WorktreeRef.describe("The connected Git worktree to change, by slug or stable id."),
};

/** Registers canonical executor tools with project-endpoint worktree routing. */
export function registerExecutorTools(
  server: McpServer,
  offers: (name: ToolName) => boolean,
  run: (
    tool: ToolName,
    args: unknown,
    context: ServerContext,
  ) => Promise<CallToolResult | InputRequiredResult>,
) {
  const meta = <N extends ToolName>(name: N) => {
    const definition = TOOL_DEFINITIONS[name] as (typeof TOOL_DEFINITIONS)[N] & {
      destructive?: boolean;
    };
    return {
      title: definition.title,
      description: definition.description,
      annotations: {
        readOnlyHint: definition.readOnly,
        ...(definition.destructive === undefined
          ? {}
          : { destructiveHint: definition.destructive }),
      },
    };
  };

  if (offers("read_file")) {
    server.registerTool(
      "read_file",
      {
        ...meta("read_file"),
        inputSchema: TOOL_DEFINITIONS.read_file.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("read_file", args, context),
    );
  }
  if (offers("list_files")) {
    server.registerTool(
      "list_files",
      {
        ...meta("list_files"),
        inputSchema: TOOL_DEFINITIONS.list_files.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("list_files", args, context),
    );
  }
  if (offers("grep")) {
    server.registerTool(
      "grep",
      {
        ...meta("grep"),
        inputSchema: TOOL_DEFINITIONS.grep.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("grep", args, context),
    );
  }
  if (offers("edit_file")) {
    server.registerTool(
      "edit_file",
      {
        ...meta("edit_file"),
        inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("edit_file", args, context),
    );
  }
  if (offers("write_file")) {
    server.registerTool(
      "write_file",
      {
        ...meta("write_file"),
        inputSchema: TOOL_DEFINITIONS.write_file.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("write_file", args, context),
    );
  }
  if (offers("apply_patch")) {
    server.registerTool(
      "apply_patch",
      {
        ...meta("apply_patch"),
        inputSchema: TOOL_DEFINITIONS.apply_patch.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("apply_patch", args, context),
    );
  }
  if (offers("list_git_worktrees")) {
    server.registerTool(
      "list_git_worktrees",
      {
        ...meta("list_git_worktrees"),
        inputSchema: TOOL_DEFINITIONS.list_git_worktrees.inputSchema.shape,
      },
      (args, context) => run("list_git_worktrees", args, context),
    );
  }
  if (offers("create_worktree")) {
    server.registerTool(
      "create_worktree",
      {
        ...meta("create_worktree"),
        inputSchema: TOOL_DEFINITIONS.create_worktree.inputSchema.safeExtend(worktreeRouting).shape,
      },
      (args, context) => run("create_worktree", args, context),
    );
  }
  if (offers("attach_worktree")) {
    server.registerTool(
      "attach_worktree",
      {
        ...meta("attach_worktree"),
        inputSchema: TOOL_DEFINITIONS.attach_worktree.inputSchema.shape,
      },
      (args, context) => run("attach_worktree", args, context),
    );
  }
  if (offers("detach_worktree")) {
    server.registerTool(
      "detach_worktree",
      {
        ...meta("detach_worktree"),
        inputSchema:
          TOOL_DEFINITIONS.detach_worktree.inputSchema.extend(requiredWorktreeRouting).shape,
      },
      (args, context) => run("detach_worktree", args, context),
    );
  }
  if (offers("remove_worktree")) {
    server.registerTool(
      "remove_worktree",
      {
        ...meta("remove_worktree"),
        inputSchema:
          TOOL_DEFINITIONS.remove_worktree.inputSchema.extend(requiredWorktreeRouting).shape,
      },
      (args, context) => run("remove_worktree", args, context),
    );
  }
  if (offers("run_command")) {
    server.registerTool(
      "run_command",
      {
        ...meta("run_command"),
        inputSchema: TOOL_DEFINITIONS.run_command.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("run_command", args, context),
    );
  }
  if (offers("start_command")) {
    server.registerTool(
      "start_command",
      {
        ...meta("start_command"),
        inputSchema: TOOL_DEFINITIONS.start_command.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("start_command", args, context),
    );
  }
  if (offers("get_command_output")) {
    server.registerTool(
      "get_command_output",
      {
        ...meta("get_command_output"),
        inputSchema: TOOL_DEFINITIONS.get_command_output.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("get_command_output", args, context),
    );
  }
  if (offers("send_command_input")) {
    server.registerTool(
      "send_command_input",
      {
        ...meta("send_command_input"),
        inputSchema: TOOL_DEFINITIONS.send_command_input.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("send_command_input", args, context),
    );
  }
  if (offers("kill_command")) {
    server.registerTool(
      "kill_command",
      {
        ...meta("kill_command"),
        inputSchema: TOOL_DEFINITIONS.kill_command.inputSchema.extend(worktreeRouting).shape,
      },
      (args, context) => run("kill_command", args, context),
    );
  }
}

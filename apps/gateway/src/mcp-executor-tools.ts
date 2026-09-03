import { TOOL_DEFINITIONS, type ToolName, WorkspaceRef } from "@exeora/protocol";
import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";

const workspaceRouting = {
  workspace: WorkspaceRef.optional().describe(
    "Run this call in a connected Git workspace by slug or id. Omit it, or use main, for the project root.",
  ),
};
const requiredWorkspaceRouting = {
  workspace: WorkspaceRef.describe("The connected Git workspace to change, by slug or stable id."),
};

/** Registers canonical executor tools with project-endpoint workspace routing. */
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
        inputSchema: TOOL_DEFINITIONS.read_file.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("read_file", args, context),
    );
  }
  if (offers("list_files")) {
    server.registerTool(
      "list_files",
      {
        ...meta("list_files"),
        inputSchema: TOOL_DEFINITIONS.list_files.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("list_files", args, context),
    );
  }
  if (offers("grep")) {
    server.registerTool(
      "grep",
      {
        ...meta("grep"),
        inputSchema: TOOL_DEFINITIONS.grep.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("grep", args, context),
    );
  }
  if (offers("edit_file")) {
    server.registerTool(
      "edit_file",
      {
        ...meta("edit_file"),
        inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("edit_file", args, context),
    );
  }
  if (offers("write_file")) {
    server.registerTool(
      "write_file",
      {
        ...meta("write_file"),
        inputSchema: TOOL_DEFINITIONS.write_file.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("write_file", args, context),
    );
  }
  if (offers("apply_patch")) {
    server.registerTool(
      "apply_patch",
      {
        ...meta("apply_patch"),
        inputSchema: TOOL_DEFINITIONS.apply_patch.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("apply_patch", args, context),
    );
  }
  if (offers("list_git_workspaces")) {
    server.registerTool(
      "list_git_workspaces",
      {
        ...meta("list_git_workspaces"),
        inputSchema: TOOL_DEFINITIONS.list_git_workspaces.inputSchema.shape,
      },
      (args, context) => run("list_git_workspaces", args, context),
    );
  }
  if (offers("create_workspace")) {
    server.registerTool(
      "create_workspace",
      {
        ...meta("create_workspace"),
        inputSchema:
          TOOL_DEFINITIONS.create_workspace.inputSchema.safeExtend(workspaceRouting).shape,
      },
      (args, context) => run("create_workspace", args, context),
    );
  }
  if (offers("attach_workspace")) {
    server.registerTool(
      "attach_workspace",
      {
        ...meta("attach_workspace"),
        inputSchema: TOOL_DEFINITIONS.attach_workspace.inputSchema.shape,
      },
      (args, context) => run("attach_workspace", args, context),
    );
  }
  if (offers("detach_workspace")) {
    server.registerTool(
      "detach_workspace",
      {
        ...meta("detach_workspace"),
        inputSchema:
          TOOL_DEFINITIONS.detach_workspace.inputSchema.extend(requiredWorkspaceRouting).shape,
      },
      (args, context) => run("detach_workspace", args, context),
    );
  }
  if (offers("remove_workspace")) {
    server.registerTool(
      "remove_workspace",
      {
        ...meta("remove_workspace"),
        inputSchema:
          TOOL_DEFINITIONS.remove_workspace.inputSchema.extend(requiredWorkspaceRouting).shape,
      },
      (args, context) => run("remove_workspace", args, context),
    );
  }
  if (offers("run_command")) {
    server.registerTool(
      "run_command",
      {
        ...meta("run_command"),
        inputSchema: TOOL_DEFINITIONS.run_command.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("run_command", args, context),
    );
  }
  if (offers("start_command")) {
    server.registerTool(
      "start_command",
      {
        ...meta("start_command"),
        inputSchema: TOOL_DEFINITIONS.start_command.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("start_command", args, context),
    );
  }
  if (offers("get_command_output")) {
    server.registerTool(
      "get_command_output",
      {
        ...meta("get_command_output"),
        inputSchema: TOOL_DEFINITIONS.get_command_output.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("get_command_output", args, context),
    );
  }
  if (offers("send_command_input")) {
    server.registerTool(
      "send_command_input",
      {
        ...meta("send_command_input"),
        inputSchema: TOOL_DEFINITIONS.send_command_input.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("send_command_input", args, context),
    );
  }
  if (offers("kill_command")) {
    server.registerTool(
      "kill_command",
      {
        ...meta("kill_command"),
        inputSchema: TOOL_DEFINITIONS.kill_command.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("kill_command", args, context),
    );
  }
  if (offers("list_skills")) {
    server.registerTool(
      "list_skills",
      {
        ...meta("list_skills"),
        inputSchema: TOOL_DEFINITIONS.list_skills.inputSchema.extend(workspaceRouting).shape,
      },
      (args, context) => run("list_skills", args, context),
    );
  }
}

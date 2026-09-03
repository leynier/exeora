import { z } from "zod";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_GREP_MATCHES,
  MAX_LIST_ENTRIES,
  MAX_PATCH_BYTES,
  MAX_PATCH_OPS,
  MAX_PROCESS_BUFFER_BYTES,
  MAX_PROCESS_CHUNK_BYTES,
  MAX_READ_BYTES,
} from "./limits.js";
import {
  ACCOUNT_TOOL_DEFINITIONS,
  type AccountToolName,
  isAccountToolName,
} from "./tools-account.js";
import { SKILL_TOOL_DEFINITIONS } from "./tools-skills.js";
import { WORKTREE_TOOL_DEFINITIONS } from "./tools-worktrees.js";

export * from "./tools-skills.js";
export * from "./tools-worktrees.js";

/**
 * The single source of truth for what an Exeora tool accepts and returns.
 *
 * The gateway feeds `inputShape` straight into `server.registerTool()`, and the
 * executor validates incoming arguments against the same shape before doing any
 * work. The executor borrows some of its file handling from other projects,
 * which describe their tools with schemas of their own; those are deliberately
 * ignored so this contract exists exactly once.
 *
 * Project `path`s are relative to the project root. Reads and command `cwd` may
 * also use `~/.agents/AGENTS.md` and `~/.agents/skills/`; anything else absolute
 * or climbing out with `..` is `PATH_ESCAPE`.
 */

const relativePath = z
  .string()
  .min(1)
  .describe("Path relative to the project root. Must stay inside the project.");

const readablePath = z
  .string()
  .min(1)
  .describe("Project-relative path, or `~/.agents/AGENTS.md` / a path under `~/.agents/skills/`.");

export const ReadFileInput = z.object({
  path: readablePath,
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based line to start reading from. Omit to start at the beginning."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum number of lines to return. Omit to read to the end."),
});

export const ReadFileOutput = z.object({
  path: z.string(),
  content: z.string(),
  /** True when the file was cut short by a limit; ask for a range to see more. */
  truncated: z.boolean(),
  totalLines: z.number().int(),
});

// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

export const ListFilesInput = z.object({
  path: readablePath
    .optional()
    .describe("Directory or file to list. Defaults to the project root."),
  recursive: z.boolean().optional().describe("Walk subdirectories. Defaults to false."),
  glob: z.string().optional().describe("Only return entries matching this glob, e.g. '**/*.ts'."),
});

export const ListFilesOutput = z.object({
  path: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      type: z.enum(["file", "directory", "symlink"]),
      size: z.number().int().optional(),
    }),
  ),
  /** True when more than MAX_LIST_ENTRIES entries matched. */
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

export const GrepInput = z.object({
  pattern: z.string().min(1).describe("Regular expression to search for."),
  path: readablePath
    .optional()
    .describe("Directory or file to search. Defaults to the project root."),
  glob: z.string().optional().describe("Restrict the search to files matching this glob."),
  caseInsensitive: z.boolean().optional().describe("Ignore case. Defaults to false."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_GREP_MATCHES)
    .optional()
    .describe(`Maximum matches to return (max ${MAX_GREP_MATCHES}).`),
});

export const GrepOutput = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      line: z.number().int(),
      text: z.string(),
    }),
  ),
  /** True when the search stopped early; narrow the pattern or glob to see more. */
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

export const EditFileInput = z.object({
  path: relativePath,
  oldString: z
    .string()
    .min(1)
    .describe(
      "Exact text to replace. Must match the file byte for byte and must appear exactly once, include surrounding lines to make it unique.",
    ),
  newString: z.string().describe("Replacement text."),
});

export const EditFileOutput = z.object({
  path: z.string(),
  replacements: z.number().int(),
  /** Unified diff of what changed, for the agent to confirm the edit landed. */
  diff: z.string(),
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export const WriteFileInput = z.object({
  path: relativePath,
  content: z.string().describe("Full contents to write. Overwrites any existing file."),
});

export const WriteFileOutput = z.object({
  path: z.string(),
  bytesWritten: z.number().int(),
  /** True when the file did not exist before this call. */
  created: z.boolean(),
});

// ---------------------------------------------------------------------------
// apply_patch
// ---------------------------------------------------------------------------

/** One file operation inside `apply_patch`. All of them land, or none of them do. */
export const ApplyPatchOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    path: relativePath,
    content: z.string().describe("Full contents of the new file."),
  }),
  z.object({
    op: z.literal("update"),
    path: relativePath,
    oldString: z
      .string()
      .min(1)
      .describe(
        "Exact text to replace. Must match the file byte for byte and must appear exactly once.",
      ),
    newString: z.string().describe("Replacement text."),
  }),
  z.object({
    op: z.literal("replace"),
    path: relativePath,
    content: z.string().describe("Full contents to write. Overwrites any existing file."),
  }),
  z.object({
    op: z.literal("delete"),
    path: relativePath,
  }),
  z.object({
    op: z.literal("move"),
    from: relativePath.describe("Existing file to move."),
    to: relativePath.describe("Destination path. Must not already exist."),
  }),
]);

export const ApplyPatchInput = z.object({
  operations: z
    .array(ApplyPatchOp)
    .min(1)
    .max(MAX_PATCH_OPS)
    .describe(
      `File operations to apply together, all or nothing (max ${MAX_PATCH_OPS}). Combined contents must stay within ${Math.round(MAX_PATCH_BYTES / 1000)}KB.`,
    ),
});

export const ApplyPatchFile = z.object({
  path: z.string(),
  op: z.enum(["create", "update", "replace", "delete", "move"]),
  /** Unified diff of what changed, omitted for a delete. */
  diff: z.string().optional(),
  created: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

export const ApplyPatchOutput = z.object({
  files: z.array(ApplyPatchFile),
});

// ---------------------------------------------------------------------------
// run_command
// ---------------------------------------------------------------------------

export const RunCommandInput = z.object({
  command: z.string().min(1).describe("Shell command to run inside the project."),
  cwd: readablePath
    .optional()
    .describe("Project-relative, or under `~/.agents/skills/`. Defaults to the project root."),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_COMMAND_TIMEOUT_MS)
    .optional()
    .describe(
      `Wall-clock budget in milliseconds (default ${DEFAULT_COMMAND_TIMEOUT_MS}, max ${MAX_COMMAND_TIMEOUT_MS}).`,
    ),
});

export const RunCommandOutput = z.object({
  command: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  /** True when output was cut to stay within the payload budget. */
  truncated: z.boolean(),
  /** True when the command was killed because it exceeded its budget. */
  timedOut: z.boolean(),
});

// ---------------------------------------------------------------------------
// Long-running processes: start returns a handle, later calls poll it.
// ---------------------------------------------------------------------------

const processId = z.string().min(1).describe("Handle returned by start_command.");

export const StartCommandInput = z.object({
  command: z.string().min(1).describe("Shell command to start inside the project."),
  cwd: readablePath
    .optional()
    .describe("Project-relative, or under `~/.agents/skills/`. Defaults to the project root."),
});

export const StartCommandOutput = z.object({
  processId: z.string(),
  command: z.string(),
  /** The operating system's id, for a person reading their own process list. */
  pid: z.number().int().nullable(),
});

export const GetCommandOutputInput = z.object({
  processId,
  cursor: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Where to read from, as returned by the previous call. Omit to read from the start."),
});

export const GetCommandOutputOutput = z.object({
  processId: z.string(),
  /** Everything since the cursor, stdout and stderr interleaved as they arrived. */
  chunk: z.string(),
  /** Pass this back next time to continue where this call stopped. */
  nextCursor: z.number().int(),
  /** True when output between the cursor and this chunk was dropped from the ring. */
  skipped: z.boolean(),
  running: z.boolean(),
  exitCode: z.number().int().nullable(),
});

export const SendCommandInputInput = z.object({
  processId,
  data: z.string().describe("Written to the process's stdin exactly as given."),
  newline: z
    .boolean()
    .optional()
    .describe("Append a newline. Defaults to true, since most prompts wait for one."),
});

export const SendCommandInputOutput = z.object({
  processId: z.string(),
  bytesWritten: z.number().int(),
});

export const KillCommandInput = z.object({ processId });

export const KillCommandOutput = z.object({
  processId: z.string(),
  /** False when it had already exited, which is not an error. */
  killed: z.boolean(),
  exitCode: z.number().int().nullable(),
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = {
  read_file: {
    title: "Read file",
    description:
      "Read a text file in the project, `~/.agents/AGENTS.md`, or under `~/.agents/skills/`. Output is truncated at " +
      `${Math.round(MAX_READ_BYTES / 1000)}KB. Use offset/limit for large files; when you need the whole ` +
      "file, continue with offset until complete.",
    inputSchema: ReadFileInput,
    outputSchema: ReadFileOutput,
    readOnly: true,
  },
  list_files: {
    title: "List files",
    description:
      "List a directory or file in the project, `~/.agents/AGENTS.md`, or under `~/.agents/skills/`. Lists one level by default; set recursive to walk " +
      "subdirectories, and glob to filter (for example '**/*.ts'). Includes dotfiles. Recursive " +
      "listings respect .gitignore and always skip .git and node_modules. Output is truncated to " +
      `${MAX_LIST_ENTRIES} entries.`,
    inputSchema: ListFilesInput,
    outputSchema: ListFilesOutput,
    readOnly: true,
  },
  grep: {
    title: "Search file contents",
    description:
      "Search a directory or file for a regular expression. Paths may be project-relative, `~/.agents/AGENTS.md`, or under `~/.agents/skills/`. Returns matching lines with file paths and " +
      "1-based line numbers. Respects .gitignore and always skips .git and node_modules. Output is " +
      `truncated to ${MAX_GREP_MATCHES} matches, and long lines to 500 characters.`,
    inputSchema: GrepInput,
    outputSchema: GrepOutput,
    readOnly: true,
  },
  edit_file: {
    title: "Edit file",
    description:
      "Edit a file by exact text replacement. oldString must match a unique region of the file, " +
      "if it appears more than once the edit is refused, so include surrounding lines to " +
      "disambiguate rather than retrying. Returns a unified diff of what changed.",
    inputSchema: EditFileInput,
    outputSchema: EditFileOutput,
    readOnly: false,
  },
  write_file: {
    title: "Write file",
    description:
      "Write content to a file, creating it if it does not exist and overwriting it entirely if it " +
      "does. Parent directories are created automatically. Prefer edit_file for changes to an " +
      "existing file, so the rest of it is not at risk.",
    inputSchema: WriteFileInput,
    outputSchema: WriteFileOutput,
    readOnly: false,
  },
  apply_patch: {
    title: "Apply a multi-file patch",
    description:
      "Apply several file operations in one call: create, update (unique text replacement), " +
      "replace (whole file), delete, or move. Checked before anything is written; if any " +
      `operation cannot run, none of them do. At most ${MAX_PATCH_OPS} operations and ` +
      `${Math.round(MAX_PATCH_BYTES / 1000)}KB. Prefer this over repeated edit_file when more ` +
      "than one file must change together.",
    inputSchema: ApplyPatchInput,
    outputSchema: ApplyPatchOutput,
    readOnly: false,
  },
  ...WORKTREE_TOOL_DEFINITIONS,
  run_command: {
    title: "Run command",
    description:
      "Run a shell command on the user's machine, in the project or under `~/.agents/skills/`. Returns stdout, stderr " +
      `and the exit code. Output is truncated to the last ${Math.round(MAX_COMMAND_OUTPUT_BYTES / 1000)}KB. ` +
      `The command is killed, with everything it started, after ${DEFAULT_COMMAND_TIMEOUT_MS / 1000}s ` +
      `by default and at most ${MAX_COMMAND_TIMEOUT_MS / 1000}s. Stdin is closed, so a command that ` +
      "waits for input exits rather than hanging.",
    inputSchema: RunCommandInput,
    outputSchema: RunCommandOutput,
    readOnly: false,
  },
  start_command: {
    title: "Start a long-running command",
    description:
      "Start a command in the project or under `~/.agents/skills/` and return immediately with a handle, for anything that outlives a single " +
      "call: a dev server, a watch task, a long test run. Read its output with get_command_output " +
      "and stop it with kill_command. It keeps running until it exits or is killed, but dies with " +
      "the connection to Exeora, so nothing is left running once nobody is watching. Use " +
      "run_command for anything that finishes on its own.",
    inputSchema: StartCommandInput,
    outputSchema: StartCommandOutput,
    readOnly: false,
  },
  get_command_output: {
    title: "Read a command's output",
    description:
      "Read output from a process started with start_command, continuing from a cursor. Returns " +
      `at most ${Math.round(MAX_PROCESS_CHUNK_BYTES / 1000)}KB per call, along with whether the ` +
      "process is still running and its exit code if not. Only " +
      `the last ${Math.round(MAX_PROCESS_BUFFER_BYTES / 1000)}KB is kept, so output is reported as ` +
      "skipped rather than silently lost if you read too slowly.",
    inputSchema: GetCommandOutputInput,
    outputSchema: GetCommandOutputOutput,
    // It changes nothing; a read-only project cannot start a process anyway.
    readOnly: true,
  },
  send_command_input: {
    title: "Write to a command's input",
    description:
      "Write to the standard input of a process started with start_command, for one waiting on an " +
      "answer. Appends a newline unless told otherwise.",
    inputSchema: SendCommandInputInput,
    outputSchema: SendCommandInputOutput,
    readOnly: false,
  },
  kill_command: {
    title: "Stop a command",
    description:
      "Stop a process started with start_command, along with everything it started. Reports " +
      "killed: false when it had already exited, which is not an error.",
    inputSchema: KillCommandInput,
    outputSchema: KillCommandOutput,
    readOnly: false,
  },
  ...SKILL_TOOL_DEFINITIONS,
} as const;

export type ToolName = keyof typeof TOOL_DEFINITIONS;

export const TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value in TOOL_DEFINITIONS;
}

/** The schema a tool's arguments must satisfy, checked on both sides of the relay. */
export function toolInputSchema<N extends ToolName>(name: N) {
  return TOOL_DEFINITIONS[name].inputSchema;
}

/** One argument of a tool, as something that only has to display it sees it. */
export interface ToolField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * A tool's arguments, flattened for display.
 *
 * Here rather than in whatever is rendering, so the documentation is generated
 * from the contract instead of written next to it. A reference page that is a
 * second description of the same thing is the one that goes quietly out of
 * date, and the zod schema is already the first.
 */
export function toolFields(name: ToolName | AccountToolName): ToolField[] {
  const definition = isAccountToolName(name)
    ? ACCOUNT_TOOL_DEFINITIONS[name]
    : TOOL_DEFINITIONS[name];

  const schema = z.toJSONSchema(definition.inputSchema) as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };

  return Object.entries(schema.properties ?? {}).map(([field, spec]) => ({
    name: field,
    type: spec.type ?? "unknown",
    required: (schema.required ?? []).includes(field),
    description: spec.description ?? "",
  }));
}

export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_DEFINITIONS)[N]["inputSchema"]>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof TOOL_DEFINITIONS)[N]["outputSchema"]>;

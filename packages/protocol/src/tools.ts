import { z } from "zod";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_GREP_MATCHES,
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
} from "./limits.js";

/**
 * The single source of truth for what an Exeora tool accepts and returns.
 *
 * The gateway feeds `inputShape` straight into `server.registerTool()`, and the
 * executor validates incoming arguments against the same shape before doing any
 * work. pi-coding-agent describes its own tools with TypeBox; we deliberately
 * ignore those schemas so this contract exists exactly once.
 *
 * Every `path` is interpreted relative to the project root and confined to it by
 * the executor. Absolute paths and anything escaping the root are rejected with
 * `PATH_ESCAPE` — see `paths.ts` in the CLI package.
 */

const relativePath = z
  .string()
  .min(1)
  .describe("Path relative to the project root. Must stay inside the project.");

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const ReadFileInput = z.object({
  path: relativePath,
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
  path: relativePath.optional().describe("Directory to list. Defaults to the project root."),
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
  path: relativePath.optional().describe("Directory to search. Defaults to the project root."),
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
      "Exact text to replace. Must match the file byte for byte and must appear exactly once — include surrounding lines to make it unique.",
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
// run_command
// ---------------------------------------------------------------------------

export const RunCommandInput = z.object({
  command: z.string().min(1).describe("Shell command to run inside the project."),
  cwd: relativePath
    .optional()
    .describe("Working directory relative to the project root. Defaults to the root."),
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
// Registry
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = {
  read_file: {
    title: "Read file",
    description:
      "Read the contents of a text file in the project. Output is truncated at " +
      `${Math.round(MAX_READ_BYTES / 1000)}KB. Use offset/limit for large files; when you need the whole ` +
      "file, continue with offset until complete.",
    inputSchema: ReadFileInput,
    outputSchema: ReadFileOutput,
    readOnly: true,
  },
  list_files: {
    title: "List files",
    description:
      "List directory contents in the project. Lists one level by default; set recursive to walk " +
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
      "Search file contents for a regular expression. Returns matching lines with file paths and " +
      "1-based line numbers. Respects .gitignore and always skips .git and node_modules. Output is " +
      `truncated to ${MAX_GREP_MATCHES} matches, and long lines to 500 characters.`,
    inputSchema: GrepInput,
    outputSchema: GrepOutput,
    readOnly: true,
  },
  edit_file: {
    title: "Edit file",
    description:
      "Edit a file by exact text replacement. oldString must match a unique region of the file — " +
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
  run_command: {
    title: "Run command",
    description:
      "Run a shell command on the user's machine, in the project directory. Returns stdout, stderr " +
      `and the exit code. Output is truncated to the last ${Math.round(MAX_COMMAND_OUTPUT_BYTES / 1000)}KB. ` +
      `The command is killed, with everything it started, after ${DEFAULT_COMMAND_TIMEOUT_MS / 1000}s ` +
      `by default and at most ${MAX_COMMAND_TIMEOUT_MS / 1000}s. Stdin is closed, so a command that ` +
      "waits for input exits rather than hanging.",
    inputSchema: RunCommandInput,
    outputSchema: RunCommandOutput,
    readOnly: false,
  },
} as const;

export type ToolName = keyof typeof TOOL_DEFINITIONS;

export const TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value in TOOL_DEFINITIONS;
}

/**
 * The schema a tool's arguments must satisfy.
 *
 * The gateway hands this straight to `registerTool({ inputSchema })` — MCP v2
 * accepts any Standard Schema object — and the executor runs the very same
 * schema over the arguments that arrive off the wire. One definition, checked
 * on both sides of the relay.
 */
export function toolInputSchema<N extends ToolName>(name: N) {
  return TOOL_DEFINITIONS[name].inputSchema;
}

export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_DEFINITIONS)[N]["inputSchema"]>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof TOOL_DEFINITIONS)[N]["outputSchema"]>;

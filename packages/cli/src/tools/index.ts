import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  ExeoraError,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_GREP_MATCHES,
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  type ToolName,
  type ToolOutput,
  toolInputSchema,
} from "@exeora/protocol";
import { execa } from "execa";
import { relativeToRoot, resolveInProject } from "../paths.js";
import { killProcess, readProcess, startProcess, writeProcess } from "./processes.js";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./vendor/edit-diff.js";
import { truncateHead } from "./vendor/truncate.js";
import { walk } from "./walk.js";

/**
 * The executor's half of the tool contract.
 *
 * Arguments arriving off the relay are validated here against the very same
 * zod schemas the gateway advertises, then every path is resolved and confined
 * to the project root before anything touches the disk.
 *
 * The matching and truncation logic in `vendor/` comes from pi-coding-agent,
 * taken rather than depended on: its published tools are built for a terminal,
 * so importing them dragged a syntax highlighter and a wasm image resizer into
 * an install that renders nothing. They also answer in prose ("Successfully
 * wrote 20 bytes to src/new.ts"), and every field this contract promises would
 * have had to be recovered by parsing English.
 */

export interface ToolContext {
  /** Absolute path of the project root. */
  root: string;
  /**
   * Aborts when the relay says the caller stopped waiting. Only `run_command`
   * can act on it in a way anyone notices; the file tools check it before
   * touching the disk and are otherwise short enough not to bother.
   */
  signal?: AbortSignal;
}

export async function executeTool(
  context: ToolContext,
  tool: ToolName,
  rawArguments: unknown,
): Promise<unknown> {
  const parsed = toolInputSchema(tool).safeParse(rawArguments);
  if (!parsed.success) {
    throw new ExeoraError("INVALID_ARGUMENTS", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const args = parsed.data;

  // A call cancelled while it queued behind another one should not start.
  if (context.signal?.aborted) {
    throw new ExeoraError("CANCELLED", "The call was cancelled before it started.");
  }

  switch (tool) {
    case "read_file":
      return readFileTool(context, args as never);
    case "list_files":
      return listFilesTool(context, args as never);
    case "grep":
      return grepTool(context, args as never);
    case "edit_file":
      return editFileTool(context, args as never);
    case "write_file":
      return writeFileTool(context, args as never);
    case "run_command":
      return runCommandTool(context, args as never);
    case "start_command":
      return startCommandTool(context, args as never);
    case "get_command_output":
      return getCommandOutputTool(context, args as never);
    case "send_command_input":
      return sendCommandInputTool(context, args as never);
    case "kill_command":
      return killCommandTool(context, args as never);
    default: {
      const exhaustive: never = tool;
      throw new ExeoraError("UNKNOWN_TOOL", `Unknown tool: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------

async function readFileTool(
  { root }: ToolContext,
  args: { path: string; offset?: number; limit?: number },
): Promise<ToolOutput<"read_file">> {
  const absolutePath = await resolveInProject({ root, relativePath: args.path });
  const relativePath = relativeToRoot(root, absolutePath);

  const buffer = await readFile(absolutePath).catch((error: NodeJS.ErrnoException) => {
    throw new ExeoraError("TOOL_FAILED", `Could not read ${relativePath}: ${error.code}.`);
  });

  // A NUL byte in the first block is the cheap, reliable binary tell. Decoding
  // a PNG as UTF-8 and handing the agent the mojibake is worse than refusing.
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new ExeoraError(
      "TOOL_FAILED",
      `${relativePath} is a binary file (${buffer.byteLength} bytes). read_file only returns text.`,
    );
  }

  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  // A trailing newline ends the last line rather than starting an empty one.
  const totalLines = text.length === 0 ? 0 : lines.at(-1) === "" ? lines.length - 1 : lines.length;

  const start = args.offset === undefined ? 0 : args.offset - 1;
  if (start > 0 && start >= totalLines) {
    throw new ExeoraError(
      "TOOL_FAILED",
      `Offset ${args.offset} is past the end of ${relativePath}, which has ${totalLines} lines.`,
    );
  }

  const end = args.limit === undefined ? totalLines : Math.min(start + args.limit, totalLines);
  const selected = lines.slice(start, end).join("\n");

  // Only the byte limit the protocol advertises. There is no line limit: the
  // caller asks for a range when it wants one, and `truncated` says when the
  // executor cut the answer short on its own.
  const truncation = truncateHead(selected, {
    maxLines: Number.POSITIVE_INFINITY,
    maxBytes: MAX_READ_BYTES,
  });

  return {
    path: relativePath,
    content: truncation.content,
    truncated: truncation.truncated || end < totalLines,
    totalLines,
  };
}

async function listFilesTool(
  { root }: ToolContext,
  args: { path?: string; recursive?: boolean; glob?: string },
): Promise<ToolOutput<"list_files">> {
  const directory = await resolveInProject({ root, relativePath: args.path ?? "." });
  const matcher = args.glob ? globToRegExp(args.glob) : null;

  const entries: ToolOutput<"list_files">["entries"] = [];
  let seen = 0;

  for await (const entry of walk({
    root,
    start: directory,
    recursive: args.recursive ?? false,
    // One over the cap, so exceeding it is detectable.
    limit: MAX_LIST_ENTRIES + 1,
  })) {
    if (matcher && !matcher.test(entry.path)) continue;
    seen++;
    if (entries.length >= MAX_LIST_ENTRIES) continue;

    let size: number | undefined;
    if (!entry.isDirectory) {
      try {
        size = (await stat(entry.absolutePath)).size;
      } catch {
        // Vanished between listing and stat; report it without a size.
      }
    }

    entries.push({
      path: entry.path,
      type: entry.isSymbolicLink ? "symlink" : entry.isDirectory ? "directory" : "file",
      ...(size === undefined ? {} : { size }),
    });
  }

  return {
    path: relativeToRoot(root, directory) || ".",
    entries,
    truncated: seen > MAX_LIST_ENTRIES,
  };
}

async function grepTool(
  { root }: ToolContext,
  args: {
    pattern: string;
    path?: string;
    glob?: string;
    caseInsensitive?: boolean;
    maxResults?: number;
  },
): Promise<ToolOutput<"grep">> {
  const directory = await resolveInProject({ root, relativePath: args.path ?? "." });
  const limit = args.maxResults ?? MAX_GREP_MATCHES;
  const globMatcher = args.glob ? globToRegExp(args.glob) : null;

  let pattern: RegExp;
  try {
    pattern = new RegExp(args.pattern, args.caseInsensitive ? "i" : "");
  } catch (error) {
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      `Not a valid regular expression: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const matches: ToolOutput<"grep">["matches"] = [];
  let truncated = false;

  for await (const entry of walk({ root, start: directory, recursive: true, limit: 50_000 })) {
    if (entry.isDirectory || entry.isSymbolicLink) continue;
    if (globMatcher && !globMatcher.test(entry.path)) continue;

    let content: string;
    try {
      content = await readFile(entry.absolutePath, "utf8");
    } catch {
      continue; // unreadable or binary: not a search hit
    }
    if (content.includes("\0")) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!pattern.test(line)) continue;

      if (matches.length >= limit) {
        truncated = true;
        return { matches, truncated };
      }
      // Long minified lines would otherwise blow the payload budget alone.
      matches.push({ path: entry.path, line: i + 1, text: line.slice(0, 500) });
    }
  }

  return { matches, truncated };
}

async function editFileTool(
  { root }: ToolContext,
  args: { path: string; oldString: string; newString: string },
): Promise<ToolOutput<"edit_file">> {
  const absolutePath = await resolveInProject({ root, relativePath: args.path });
  const relativePath = relativeToRoot(root, absolutePath);

  const raw = await readFile(absolutePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    throw new ExeoraError("TOOL_FAILED", `Could not edit ${relativePath}: ${error.code}.`);
  });

  // The BOM comes off before matching, since no caller puts an invisible
  // character in oldString, and goes back on before writing. Same for CRLF:
  // matching happens in LF space, the file keeps the endings it had.
  const { bom, text: content } = stripBom(raw);
  const ending = detectLineEnding(content);

  // Throws rather than guessing when the text appears more than once.
  const { baseContent, newContent } = applyEditsToNormalizedContent(
    normalizeToLF(content),
    [{ oldText: args.oldString, newText: args.newString }],
    relativePath,
  );

  await writeFile(absolutePath, bom + restoreLineEndings(newContent, ending), "utf8");

  return {
    path: relativePath,
    replacements: 1,
    diff: generateUnifiedPatch(relativePath, baseContent, newContent),
  };
}

async function writeFileTool(
  { root }: ToolContext,
  args: { path: string; content: string },
): Promise<ToolOutput<"write_file">> {
  const absolutePath = await resolveInProject({ root, relativePath: args.path });

  const existed = await stat(absolutePath).then(
    () => true,
    () => false,
  );
  // Parent directories are created for you; without this, writing the first
  // file into a new folder fails with a bare ENOENT the agent cannot act on.
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, args.content, "utf8");

  return {
    path: relativeToRoot(root, absolutePath),
    bytesWritten: Buffer.byteLength(args.content, "utf8"),
    created: !existed,
  };
}

async function runCommandTool(
  { root, signal }: ToolContext,
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<ToolOutput<"run_command">> {
  const cwd = await resolveInProject({ root, relativePath: args.cwd ?? "." });
  const timeoutMs = args.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  const subprocess = execa(args.command, {
    shell: true,
    cwd,
    // `detached` makes the shell a process-group leader so the whole tree can
    // be signalled at once. execa's own `timeout` only kills the shell, and an
    // orphaned child keeps the inherited stdout pipe open, so `sleep 30` under
    // a 1s timeout would still block for the full 30 seconds.
    detached: process.platform !== "win32",
    reject: false,
    all: false,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES * 4,
    // Never inherit the terminal: the executor runs headless, and a command
    // that waits for input would otherwise hang until the deadline.
    stdin: "ignore",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(subprocess.pid);
  }, timeoutMs);

  // Cancellation kills the tree exactly the way the timeout does. The only
  // difference is what happens after: a timeout still reports what the command
  // managed to print, while a cancelled call has nobody left to report to.
  let cancelled = false;
  const onCancel = () => {
    cancelled = true;
    killTree(subprocess.pid);
  };

  // `addEventListener` never fires for a signal that aborted already, and the
  // await resolving `cwd` above is long enough for that to happen.
  if (signal?.aborted) onCancel();
  else signal?.addEventListener("abort", onCancel, { once: true });

  let result: Awaited<typeof subprocess>;
  try {
    result = await subprocess;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCancel);
  }

  if (cancelled) {
    throw new ExeoraError("CANCELLED", "The call was cancelled while the command was running.");
  }

  const stdout = capture(result.stdout);
  const stderr = capture(result.stderr);

  return {
    command: args.command,
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut,
  };
}

// ---------------------------------------------------------------------------

/**
 * The four tools for a process that outlives its call.
 *
 * Thin on purpose: the registry in `processes.ts` owns the state, the buffers
 * and the killing, and these only resolve the working directory and hand over.
 */

async function startCommandTool(
  { root }: ToolContext,
  args: { command: string; cwd?: string },
): Promise<ToolOutput<"start_command">> {
  const cwd = await resolveInProject({ root, relativePath: args.cwd ?? "." });
  return startProcess({ root, cwd, command: args.command });
}

function getCommandOutputTool(
  { root }: ToolContext,
  args: { processId: string; cursor?: number },
): ToolOutput<"get_command_output"> {
  return readProcess(root, args.processId, args.cursor);
}

function sendCommandInputTool(
  { root }: ToolContext,
  args: { processId: string; data: string; newline?: boolean },
): ToolOutput<"send_command_input"> {
  return writeProcess(root, args.processId, args.data, args.newline ?? true);
}

function killCommandTool(
  { root }: ToolContext,
  args: { processId: string },
): ToolOutput<"kill_command"> {
  return killProcess(root, args.processId);
}

/** Kills the command and everything it started. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;

  if (process.platform === "win32") {
    // Windows has no process groups to signal; taskkill /T walks the tree.
    execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false });
    return;
  }

  try {
    // Negative pid targets the process group created by `detached`.
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone, or never became a group leader: fall back to the process.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Nothing left to kill.
    }
  }
}

// ---------------------------------------------------------------------------

/** Keeps the tail: the end of a failing build is what explains the failure. */
function capture(raw: unknown): { text: string; truncated: boolean } {
  const text = typeof raw === "string" ? raw : "";
  if (Buffer.byteLength(text, "utf8") <= MAX_COMMAND_OUTPUT_BYTES) {
    return { text, truncated: false };
  }
  return { text: text.slice(-MAX_COMMAND_OUTPUT_BYTES), truncated: true };
}

/**
 * Minimal glob support: `*` within a segment, `**` across segments, and `?`.
 *
 * Scans the pattern once rather than chaining replaces. The chained version
 * needed placeholder strings to stop the `*` rule from eating `**`, and any
 * placeholder can also occur in a real filename.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = "";

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];

    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero directories too, so `**/*.ts` finds a top-level a.ts.
        if (glob[i + 2] === "/") {
          pattern += "(?:.*/)?";
          i += 2;
        } else {
          pattern += ".*";
          i += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      pattern += "[^/]";
      continue;
    }

    // Everything else is literal, including regex metacharacters.
    pattern += char === undefined ? "" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${pattern}$`);
}

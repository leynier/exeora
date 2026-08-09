import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolName } from "@exeora/protocol";
import {
  ALTERNATION_PATTERN,
  BLOB_PATTERN,
  EDIT_ANCHOR_NEW,
  EDIT_ANCHOR_OLD,
  HEAVY,
  LONG_LINE_PATTERN,
  MISS_PATTERN,
  type Weight,
} from "./config.js";

/**
 * The hard suite as data, so timing it and verifying it cannot drift apart.
 *
 * Each case is here because it makes one specific cost dominate: a multi-
 * megabyte decode, a full-corpus scan with no early exit, a regex with nothing
 * to prefilter on, or binary the search has to decline. `examples/compare_tools`
 * holds the same list, and `--verify` checks the two engines answer alike
 * before any ratio between them is reported.
 */

export interface HardCase {
  name: string;
  weight: Weight;
  tool: ToolName;
  arguments: Record<string, unknown>;
  /** edit_file rewrites its target, so the fixture is restored per iteration. */
  reset?: boolean;
}

export const LARGE_WRITE_CONTENT = "x".repeat(8 * 1024 * 1024);

export function hardCases(): HardCase[] {
  return [
    // 8 MB of text to decode, split and truncate, against a 500 KB answer.
    {
      name: "read_file_8mb",
      weight: "medium",
      tool: "read_file",
      arguments: { path: "big/haystack.rs" },
    },
    // The same file for a hundred lines at the end: all of the splitting, none
    // of the joining, which is where the two engines stop agreeing on the cost.
    {
      name: "read_file_tail_slice",
      weight: "light",
      tool: "read_file",
      arguments: { path: "big/haystack.rs", offset: HEAVY.haystackLines - 1_000, limit: 100 },
    },
    // A thousand entries, each one a stat: an await per file against a syscall per file.
    {
      name: "list_files_corpus_1k",
      weight: "medium",
      tool: "list_files",
      arguments: { path: "corpus", recursive: true },
    },
    {
      name: "list_files_glob_corpus",
      weight: "medium",
      tool: "list_files",
      arguments: { path: "corpus", recursive: true, glob: "**/unit-0*.rs" },
    },
    // Nothing matches, so neither engine may stop early: 6 MB read line by line.
    {
      name: "grep_full_scan_miss",
      weight: "xheavy",
      tool: "grep",
      arguments: { pattern: MISS_PATTERN, path: "corpus", maxResults: 200 },
    },
    // Forty hits behind four alternated prefixes, folded: the cost is a literal
    // set rather than a single needle, and the regex still runs on every hit.
    {
      name: "grep_regex_alternation",
      weight: "xheavy",
      tool: "grep",
      arguments: {
        pattern: ALTERNATION_PATTERN,
        path: "corpus",
        caseInsensitive: true,
        maxResults: 200,
      },
    },
    // 100 KB lines with the match at the end: line handling with no line breaks to help.
    {
      name: "grep_long_lines",
      weight: "heavy",
      tool: "grep",
      arguments: { pattern: LONG_LINE_PATTERN, path: "minified", maxResults: 200 },
    },
    // 4 MB of binary to decline: decoded and then rejected, or abandoned at the first NUL.
    {
      name: "grep_binary_corpus",
      weight: "heavy",
      tool: "grep",
      arguments: { pattern: BLOB_PATTERN, path: "blobs", maxResults: 200 },
    },
    // One replacement in 30,000 lines, plus the unified diff that has to prove it.
    {
      name: "edit_file_2mb",
      weight: "heavy",
      tool: "edit_file",
      arguments: {
        path: "big/editable.rs",
        oldString: EDIT_ANCHOR_OLD,
        newString: EDIT_ANCHOR_NEW,
      },
      reset: true,
    },
    {
      name: "write_file_8mb",
      weight: "medium",
      tool: "write_file",
      arguments: { path: "big/written.txt", content: LARGE_WRITE_CONTENT },
    },
    // 700 KB through a pipe, of which the contract returns the last 200 KB.
    {
      name: "run_command_700kb_stdout",
      weight: "heavy",
      tool: "run_command",
      arguments: { command: stdoutCommand() },
    },
  ];
}

export function stdoutCommand(): string {
  return process.platform === "win32"
    ? "type streams\\stdout-700k.txt"
    : "cat streams/stdout-700k.txt";
}

export async function resetCase(root: string): Promise<void> {
  await copyFile(join(root, "big/editable-pristine.rs"), join(root, "big/editable.rs"));
}

export function unitPath(index: number): string {
  const pkg = index % HEAVY.packages;
  const module = (index >> 2) % HEAVY.modules;
  const unit = index % HEAVY.units;
  return `corpus/pkg-${pad(pkg, 2)}/mod-${module}/unit-${pad(unit, 2)}.rs`;
}

export function packagePath(index: number): string {
  return `corpus/pkg-${pad(index % HEAVY.packages, 2)}`;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

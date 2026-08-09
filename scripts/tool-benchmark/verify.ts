import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { executeTool } from "../../packages/cli/src/tools/index.js";
import { killAllProcesses } from "../../packages/cli/src/tools/processes.js";
import { EDIT_ANCHOR_NEW } from "./config.js";
import { hardCases, resetCase } from "./hard-cases.js";
import { fillUnicodeRing } from "./hard-suite.js";

/**
 * What each hard case answered, reduced to a line both engines can be held to.
 *
 * A speedup only means something if the two engines did the same work, and the
 * binary case is the reason this exists: an engine that walks away from 4 MB of
 * blobs at the first NUL byte looks identical to one that never opened them.
 * Unified diffs are excluded on purpose, since `diff` and `similar` format the
 * same edit differently; the file left on disk is checked instead.
 */

export type Fingerprints = Record<string, string>;

export async function fingerprintHardSuite(root: string): Promise<Fingerprints> {
  const context = { root };
  const fingerprints: Fingerprints = {};

  for (const testCase of hardCases()) {
    if (testCase.reset) await resetCase(root);
    const result = (await executeTool(context, testCase.tool, testCase.arguments)) as never;
    fingerprints[testCase.name] = await fingerprint(root, testCase.tool, result);
  }

  const processId = await fillUnicodeRing(context);
  const output = (await executeTool(context, "get_command_output", {
    processId,
    cursor: 0,
  })) as { chunk: string; nextCursor: number; skipped: boolean };
  // Not the cursor: both rings evict whole chunks, and a chunk is whatever one
  // read off the pipe returned, so how much was dropped is the kernel's answer
  // rather than the executor's. The slice handed back is the comparable part.
  fingerprints.get_command_output_unicode = `units=${output.chunk.length} skipped=${output.skipped}`;
  await executeTool(context, "kill_command", { processId });
  killAllProcesses();

  return fingerprints;
}

async function fingerprint(root: string, tool: string, result: never): Promise<string> {
  const value = result as Record<string, never>;

  switch (tool) {
    case "read_file":
      return `path=${value.path} lines=${value.totalLines} truncated=${value.truncated} bytes=${bytes(value.content)}`;
    case "list_files": {
      const entries = value.entries as { path: string }[];
      return `entries=${entries.length} truncated=${value.truncated} first=${edge(entries.at(0)?.path)} last=${edge(entries.at(-1)?.path)}`;
    }
    case "grep": {
      const matches = value.matches as { path: string; line: number }[];
      return `matches=${matches.length} truncated=${value.truncated} first=${where(matches.at(0))} last=${where(matches.at(-1))}`;
    }
    case "edit_file": {
      const content = await readFile(join(root, value.path as string), "utf8");
      return `path=${value.path} replacements=${value.replacements} fileBytes=${bytes(content)} anchored=${content.includes(EDIT_ANCHOR_NEW)}`;
    }
    case "write_file":
      return `path=${value.path} bytes=${value.bytesWritten} created=${value.created}`;
    case "run_command":
      return `exit=${value.exitCode} truncated=${value.truncated} timedOut=${value.timedOut} stdout=${bytes(value.stdout)} stderr=${bytes(value.stderr)}`;
    default:
      throw new Error(`No fingerprint defined for ${tool}`);
  }
}

function bytes(text: unknown): number {
  return Buffer.byteLength(typeof text === "string" ? text : "", "utf8");
}

function edge(path: string | undefined): string {
  return path ?? "none";
}

function where(match: { path: string; line: number } | undefined): string {
  return match ? `${match.path}:${match.line}` : "none";
}

export function diffFingerprints(
  typescript: Fingerprints,
  rust: Fingerprints,
): { name: string; typescript: string; rust: string }[] {
  const names = new Set([...Object.keys(typescript), ...Object.keys(rust)]);
  const mismatches: { name: string; typescript: string; rust: string }[] = [];

  for (const name of names) {
    const left = typescript[name] ?? "missing";
    const right = rust[name] ?? "missing";
    if (left !== right) mismatches.push({ name, typescript: left, rust: right });
  }
  return mismatches;
}

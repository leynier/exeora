import type { ToolName } from "@exeora/protocol";
import { executeTool, type ToolContext } from "../../packages/cli/src/tools/index.js";

/**
 * Timing primitives shared by both benchmark suites.
 *
 * The timed region is the tool call and nothing else: fixtures, argument
 * construction and per-iteration resets happen around it, never inside it. The
 * Rust example mirrors this file operation for operation, and the comparison
 * refuses to report a case whose iteration or sample counts drifted apart.
 */

/** Untimed calls that let the JIT, the page cache and the thread pools settle. */
export const WARMUP = 3;

/**
 * A tool call, including the JSON the relay sends afterwards.
 *
 * The serialization is not decoration. A JavaScript engine builds the result of
 * `chunks.join("")` as a rope and only flattens it when something reads the
 * characters, so a benchmark that discards the result measures an answer that
 * was never produced: `get_command_output` looked ten times faster in
 * TypeScript than a Rust `String` that had already been written out. Both
 * executors serialize every result before it goes on the wire, so both are
 * charged for it here and neither can defer the work past the timer.
 */
let serialized = 0;

export async function call(context: ToolContext, tool: ToolName, args: unknown): Promise<unknown> {
  const value = await executeTool(context, tool, args);
  serialized += JSON.stringify(value).length;
  return value;
}

/** Keeps the serialization above observable, so nothing may elide it. */
export function serializedLength(): number {
  return serialized;
}

export interface CaseResult {
  name: string;
  iterations: number;
  samples: number;
  medianNs: number;
}

export interface BenchmarkResult {
  engine: "typescript" | "rust";
  cases: CaseResult[];
}

export async function elapsed(operation: () => Promise<unknown>): Promise<bigint> {
  const started = process.hrtime.bigint();
  await operation();
  return process.hrtime.bigint() - started;
}

export type Measure = (
  name: string,
  count: number,
  operation: () => Promise<bigint>,
) => Promise<CaseResult>;

/**
 * Reports the median of `samples` averages rather than the mean of everything.
 *
 * One descheduled iteration inflates an average; it takes half the samples to
 * move a median, and shared runners deschedule often enough to matter.
 */
export function measurer(samples: number): Measure {
  return async (name, count, operation) => {
    for (let index = 0; index < WARMUP; index++) await operation();

    const averages: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      let total = 0n;
      for (let index = 0; index < count; index++) total += await operation();
      averages.push(Number(total) / count);
    }
    averages.sort((left, right) => left - right);
    return {
      name,
      iterations: count,
      samples,
      medianNs: averages[Math.floor(averages.length / 2)] ?? Number.NaN,
    };
  };
}

export function getProcessId(result: unknown): string {
  const processId = (result as { processId?: unknown }).processId;
  if (typeof processId !== "string") throw new Error("start_command did not return processId");
  return processId;
}

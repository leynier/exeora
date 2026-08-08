import * as p from "@clack/prompts";
import type { Command } from "commander";

/**
 * How a command says anything, and how it fails.
 *
 * `--json` is global rather than per command because the reason to want it is
 * global: something other than a person is reading. It is read back off the
 * root command instead of being copied into a boolean, so it is still the truth
 * at the moment a handler asks rather than at the moment the program was built.
 */

let root: Command | undefined;

/** Called once by `index.ts`, before any action can run. */
export function configureOutput(program: Command): void {
  root = program;
}

/** Whether this invocation asked for machine-readable output. */
export function asJson(): boolean {
  return root?.opts().json === true;
}

/** One JSON document on stdout, which is the whole point of `--json`. */
export function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Turns a thrown error into one readable line instead of a stack trace.
 *
 * Under `--json` it becomes a document on stderr rather than stdout, so a
 * caller piping stdout into a parser gets either valid JSON or nothing, never
 * an error message where a result was expected. The exit code says which.
 */
export function guard<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (asJson()) process.stderr.write(`${JSON.stringify({ error: message })}\n`);
      else p.log.error(message);
      process.exitCode = 1;
    }
  };
}

import { killAllProcesses } from "../../packages/cli/src/tools/processes.js";
import {
  ALTERNATION_PATTERN,
  FANOUT,
  hardIterations,
  MISS_PATTERN,
  samplesFor,
  UNICODE_CHUNKS,
  UNICODE_UNIT,
  UNICODE_UNIT_REPEATS,
  type Weight,
} from "./config.js";
import { hardCases, packagePath, resetCase, unitPath } from "./hard-cases.js";
import { type CaseResult, call, elapsed, getProcessId, measurer } from "./harness.js";

/**
 * Times the hard cases, then the two shapes that are not a single call.
 *
 * The single-call cases come from `hard-cases.ts` so the verifier exercises the
 * exact arguments the timings came from. Concurrency and the unicode ring
 * buffer need a live process or a batch, and are built here.
 */

const INTERACTIVE_COMMAND = process.platform === "win32" ? "more" : "cat";

interface Context {
  root: string;
}

export async function runHardSuite(root: string, quick: boolean): Promise<CaseResult[]> {
  const context = { root };
  const measure = measurer(samplesFor("hard", quick));
  const count = (weight: Weight) => hardIterations(weight, quick);
  const cases: CaseResult[] = [];

  for (const testCase of hardCases()) {
    cases.push(
      await measure(testCase.name, count(testCase.weight), async () => {
        if (testCase.reset) await resetCase(root);
        return elapsed(() => call(context, testCase.tool, testCase.arguments));
      }),
    );
  }

  cases.push(await unicodeOutputCase(context, measure, count("light")));
  cases.push(...(await concurrencyCases(context, measure, count)));

  killAllProcesses();
  return cases;
}

/**
 * A full ring buffer of multi-byte text, read from the start.
 *
 * The cursor the contract hands out counts UTF-16 units, which is what a
 * JavaScript string is indexed in and what a Rust `String` is not.
 */
async function unicodeOutputCase(
  context: Context,
  measure: ReturnType<typeof measurer>,
  iterations: number,
): Promise<CaseResult> {
  const processId = await fillUnicodeRing(context);
  const result = await measure("get_command_output_unicode", iterations, () =>
    elapsed(() => call(context, "get_command_output", { processId, cursor: 0 })),
  );

  await call(context, "kill_command", { processId });
  killAllProcesses();
  return result;
}

/** Starts a process and overruns its 256,000-unit ring with multi-byte text. */
export async function fillUnicodeRing(context: Context): Promise<string> {
  const started = await call(context, "start_command", { command: INTERACTIVE_COMMAND });
  const processId = getProcessId(started);
  const chunk = UNICODE_UNIT.repeat(UNICODE_UNIT_REPEATS);

  for (let index = 0; index < UNICODE_CHUNKS; index++) {
    await call(context, "send_command_input", { processId, data: chunk, newline: false });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return processId;
}

/**
 * Bursts, because the relay does not wait for one call before starting the next.
 *
 * Timed as one batch: the question is how long the whole burst takes, not how
 * long any call inside it took.
 */
async function concurrencyCases(
  context: Context,
  measure: ReturnType<typeof measurer>,
  count: (weight: Weight) => number,
): Promise<CaseResult[]> {
  const reads = Array.from({ length: FANOUT.reads }, (_, index) => unitPath(index));
  const cases: CaseResult[] = [];

  cases.push(
    await measure(`concurrent_reads_x${FANOUT.reads}`, count("heavy"), () =>
      elapsed(() => Promise.all(reads.map((path) => call(context, "read_file", { path })))),
    ),
  );
  cases.push(
    await measure(`concurrent_greps_x${FANOUT.greps}`, count("xheavy"), () =>
      elapsed(() =>
        Promise.all(
          Array.from({ length: FANOUT.greps }, () =>
            call(context, "grep", {
              pattern: ALTERNATION_PATTERN,
              path: "corpus/pkg-00",
              caseInsensitive: true,
              maxResults: 200,
            }),
          ),
        ),
      ),
    ),
  );

  const mixed = FANOUT.mixedReads + FANOUT.mixedLists + FANOUT.mixedGreps;
  cases.push(
    await measure(`concurrent_mixed_x${mixed}`, count("xheavy"), () =>
      elapsed(() =>
        Promise.all([
          ...Array.from({ length: FANOUT.mixedReads }, (_, index) =>
            call(context, "read_file", { path: unitPath(index) }),
          ),
          ...Array.from({ length: FANOUT.mixedLists }, (_, index) =>
            call(context, "list_files", { path: packagePath(index), recursive: true }),
          ),
          ...Array.from({ length: FANOUT.mixedGreps }, (_, index) =>
            call(context, "grep", {
              pattern: MISS_PATTERN,
              path: packagePath(index),
              maxResults: 200,
            }),
          ),
        ]),
      ),
    ),
  );

  return cases;
}

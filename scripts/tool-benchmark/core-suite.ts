import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { killAllProcesses } from "../../packages/cli/src/tools/processes.js";
import { coreIterations, samplesFor } from "./config.js";
import { type CaseResult, call, elapsed, getProcessId, measurer } from "./harness.js";

/**
 * The ten tool calls at the size an agent hits them all day.
 *
 * Small file, small directory, short command. This is the suite CI gates on,
 * because a regression here is a regression in the common path; the hard suite
 * exists to answer the different question of where the two engines diverge.
 */

const SHORT_COMMAND = process.platform === "win32" ? "echo|set /p=exeora" : "printf exeora";
const INTERACTIVE_COMMAND = process.platform === "win32" ? "more" : "cat";

export async function runCoreSuite(root: string, quick: boolean): Promise<CaseResult[]> {
  const context = { root };
  const measure = measurer(samplesFor("core", quick));
  const files = coreIterations("file", quick);
  const processes = coreIterations("process", quick);
  const cases: CaseResult[] = [];

  cases.push(
    await measure("read_file", files, () =>
      elapsed(() => call(context, "read_file", { path: "src/module-000.rs" })),
    ),
  );
  cases.push(
    await measure("list_files", files, () =>
      elapsed(() => call(context, "list_files", { path: "src", recursive: true })),
    ),
  );
  cases.push(
    await measure("grep", coreIterations("grep", quick), () =>
      elapsed(() =>
        call(context, "grep", {
          pattern: "indexed_symbol",
          path: "src",
          maxResults: 200,
        }),
      ),
    ),
  );
  cases.push(
    await measure("edit_file", files, async () => {
      await writeFile(join(root, "edit.txt"), "before\nneedle\nafter\n");
      return elapsed(() =>
        call(context, "edit_file", {
          path: "edit.txt",
          oldString: "needle",
          newString: "replacement",
        }),
      );
    }),
  );
  const writeContent = "x".repeat(64 * 1024);
  cases.push(
    await measure("write_file", files, () =>
      elapsed(() => call(context, "write_file", { path: "output.txt", content: writeContent })),
    ),
  );
  cases.push(
    await measure("run_command", processes, () =>
      elapsed(() => call(context, "run_command", { command: SHORT_COMMAND })),
    ),
  );
  cases.push(
    await measure("start_command", processes, async () => {
      const started = process.hrtime.bigint();
      const result = await call(context, "start_command", { command: INTERACTIVE_COMMAND });
      const duration = process.hrtime.bigint() - started;
      await call(context, "kill_command", { processId: getProcessId(result) });
      killAllProcesses();
      return duration;
    }),
  );
  cases.push(
    await measure("kill_command", processes, async () => {
      const result = await call(context, "start_command", { command: INTERACTIVE_COMMAND });
      const duration = await elapsed(() =>
        call(context, "kill_command", { processId: getProcessId(result) }),
      );
      killAllProcesses();
      return duration;
    }),
  );

  const persistent = await call(context, "start_command", { command: INTERACTIVE_COMMAND });
  const persistentId = getProcessId(persistent);
  cases.push(
    await measure("send_command_input", files, () =>
      elapsed(() =>
        call(context, "send_command_input", {
          processId: persistentId,
          data: "ping",
          newline: true,
        }),
      ),
    ),
  );
  await call(context, "send_command_input", {
    processId: persistentId,
    data: "x".repeat(150_000),
    newline: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  cases.push(
    await measure("get_command_output", files, () =>
      elapsed(() => call(context, "get_command_output", { processId: persistentId, cursor: 0 })),
    ),
  );
  await call(context, "kill_command", { processId: persistentId });
  killAllProcesses();

  return cases;
}

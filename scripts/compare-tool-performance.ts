import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../packages/cli/src/tools/index.js";
import { killAllProcesses } from "../packages/cli/src/tools/processes.js";

const ROOT = join(import.meta.dirname, "..");
const QUICK = process.argv.includes("--quick");
const CHECK = process.argv.includes("--check");
const JSON_OUTPUT = process.argv.includes("--json");
const SAMPLES = QUICK ? 3 : 5;

interface CaseResult {
  name: string;
  iterations: number;
  samples: number;
  medianNs: number;
}

interface BenchmarkResult {
  engine: "typescript" | "rust";
  cases: CaseResult[];
}

interface Comparison {
  name: string;
  iterations: number;
  typescriptNs: number;
  rustNs: number;
  speedup: number;
}

function iterations(kind: "file" | "grep" | "process"): number {
  if (QUICK) return kind === "file" ? 20 : kind === "grep" ? 3 : 5;
  return kind === "file" ? 100 : kind === "grep" ? 10 : 20;
}

async function createFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "src"));
  const body = 'fn indexed_symbol() { println!("exeora benchmark"); }\n'.repeat(128);
  await Promise.all(
    Array.from({ length: 128 }, (_, index) =>
      writeFile(join(root, `src/module-${index.toString().padStart(3, "0")}.rs`), body),
    ),
  );
  return root;
}

async function elapsed(operation: () => Promise<unknown>): Promise<bigint> {
  const started = process.hrtime.bigint();
  await operation();
  return process.hrtime.bigint() - started;
}

async function measure(
  name: string,
  count: number,
  operation: () => Promise<bigint>,
): Promise<CaseResult> {
  for (let index = 0; index < 3; index++) await operation();

  const averages: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    let total = 0n;
    for (let index = 0; index < count; index++) total += await operation();
    averages.push(Number(total) / count);
  }
  averages.sort((left, right) => left - right);
  return {
    name,
    iterations: count,
    samples: SAMPLES,
    medianNs: averages[Math.floor(averages.length / 2)] ?? Number.NaN,
  };
}

function getProcessId(result: unknown): string {
  const processId = (result as { processId?: unknown }).processId;
  if (typeof processId !== "string") throw new Error("start_command did not return processId");
  return processId;
}

async function benchmarkTypescript(root: string): Promise<BenchmarkResult> {
  const context = { root };
  const cases: CaseResult[] = [];
  const fileIterations = iterations("file");
  const processIterations = iterations("process");

  cases.push(
    await measure("read_file", fileIterations, () =>
      elapsed(() => executeTool(context, "read_file", { path: "src/module-000.rs" })),
    ),
  );
  cases.push(
    await measure("list_files", fileIterations, () =>
      elapsed(() => executeTool(context, "list_files", { path: "src", recursive: true })),
    ),
  );
  cases.push(
    await measure("grep", iterations("grep"), () =>
      elapsed(() =>
        executeTool(context, "grep", {
          pattern: "indexed_symbol",
          path: "src",
          maxResults: 200,
        }),
      ),
    ),
  );
  cases.push(
    await measure("edit_file", fileIterations, async () => {
      await writeFile(join(root, "edit.txt"), "before\nneedle\nafter\n");
      return elapsed(() =>
        executeTool(context, "edit_file", {
          path: "edit.txt",
          oldString: "needle",
          newString: "replacement",
        }),
      );
    }),
  );
  const writeContent = "x".repeat(64 * 1024);
  cases.push(
    await measure("write_file", fileIterations, () =>
      elapsed(() =>
        executeTool(context, "write_file", { path: "output.txt", content: writeContent }),
      ),
    ),
  );
  const shortCommand = process.platform === "win32" ? "echo|set /p=exeora" : "printf exeora";
  const interactiveCommand = process.platform === "win32" ? "more" : "cat";
  cases.push(
    await measure("run_command", processIterations, () =>
      elapsed(() => executeTool(context, "run_command", { command: shortCommand })),
    ),
  );
  cases.push(
    await measure("start_command", processIterations, async () => {
      const started = process.hrtime.bigint();
      const result = await executeTool(context, "start_command", { command: interactiveCommand });
      const duration = process.hrtime.bigint() - started;
      await executeTool(context, "kill_command", { processId: getProcessId(result) });
      killAllProcesses();
      return duration;
    }),
  );
  cases.push(
    await measure("kill_command", processIterations, async () => {
      const result = await executeTool(context, "start_command", { command: interactiveCommand });
      const duration = await elapsed(() =>
        executeTool(context, "kill_command", { processId: getProcessId(result) }),
      );
      killAllProcesses();
      return duration;
    }),
  );

  const persistent = await executeTool(context, "start_command", { command: interactiveCommand });
  const persistentId = getProcessId(persistent);
  cases.push(
    await measure("send_command_input", fileIterations, () =>
      elapsed(() =>
        executeTool(context, "send_command_input", {
          processId: persistentId,
          data: "ping",
          newline: true,
        }),
      ),
    ),
  );
  await executeTool(context, "send_command_input", {
    processId: persistentId,
    data: "x".repeat(150_000),
    newline: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  cases.push(
    await measure("get_command_output", fileIterations, () =>
      elapsed(() =>
        executeTool(context, "get_command_output", { processId: persistentId, cursor: 0 }),
      ),
    ),
  );
  await executeTool(context, "kill_command", { processId: persistentId });
  killAllProcesses();
  return { engine: "typescript", cases };
}

async function benchmarkRust(root: string): Promise<BenchmarkResult> {
  await run("cargo", ["build", "--locked", "--release", "--example", "compare_tools"]);

  const runArguments = [
    "run",
    "--quiet",
    "--locked",
    "--release",
    "--example",
    "compare_tools",
    "--",
    "--fixture",
    root,
  ];
  if (QUICK) runArguments.push("--quick");
  const output = await run("cargo", runArguments, true);
  return JSON.parse(output) as BenchmarkResult;
}

function run(command: string, arguments_: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: ROOT,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function compare(typescript: BenchmarkResult, rust: BenchmarkResult): Comparison[] {
  if (typescript.cases.length !== 10 || rust.cases.length !== 10) {
    throw new Error("Both engines must report all ten tool calls");
  }
  const rustCases = new Map(rust.cases.map((result) => [result.name, result]));
  return typescript.cases.map((tsCase) => {
    const rustCase = rustCases.get(tsCase.name);
    if (!rustCase) throw new Error(`Rust result is missing ${tsCase.name}`);
    if (rustCase.iterations !== tsCase.iterations || rustCase.samples !== tsCase.samples) {
      throw new Error(`The engines used different sample settings for ${tsCase.name}`);
    }
    if (!(tsCase.medianNs > 0) || !(rustCase.medianNs > 0)) {
      throw new Error(`The engines reported an invalid duration for ${tsCase.name}`);
    }
    return {
      name: tsCase.name,
      iterations: tsCase.iterations,
      typescriptNs: tsCase.medianNs,
      rustNs: rustCase.medianNs,
      speedup: tsCase.medianNs / rustCase.medianNs,
    };
  });
}

function geometricMean(values: number[]): number {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function duration(nanoseconds: number): string {
  if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(2)} ms`;
  if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(2)} us`;
  return `${nanoseconds.toFixed(0)} ns`;
}

function printTable(comparisons: Comparison[], mean: number): void {
  console.log("| tool call | TypeScript | Rust | Rust speedup | winner |");
  console.log("| --- | ---: | ---: | ---: | --- |");
  for (const result of comparisons) {
    const winner = result.speedup >= 1 ? "Rust" : "TypeScript";
    console.log(
      `| ${result.name} | ${duration(result.typescriptNs)} | ${duration(result.rustNs)} | ${result.speedup.toFixed(2)}x | ${winner} |`,
    );
  }
  console.log(`\nGeometric mean Rust speedup: ${mean.toFixed(2)}x`);
}

const typescriptRoot = await createFixture("exeora-ts-tools-");
const rustRoot = await createFixture("exeora-rust-tools-");
try {
  const typescript = await benchmarkTypescript(typescriptRoot);
  const rust = await benchmarkRust(rustRoot);
  const comparisons = compare(typescript, rust);
  const mean = geometricMean(comparisons.map((result) => result.speedup));

  if (JSON_OUTPUT)
    console.log(JSON.stringify({ typescript, rust, comparisons, geometricMean: mean }));
  else printTable(comparisons, mean);

  if (CHECK && mean < 1) {
    console.error(`Rust regressed: geometric mean speedup is ${mean.toFixed(2)}x (minimum 1.00x).`);
    process.exitCode = 1;
  }
} finally {
  killAllProcesses();
  await Promise.all([
    rm(typescriptRoot, { recursive: true, force: true }),
    rm(rustRoot, { recursive: true, force: true }),
  ]);
}

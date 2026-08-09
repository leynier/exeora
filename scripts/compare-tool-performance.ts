import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { killAllProcesses } from "../packages/cli/src/tools/processes.js";
import type { Suite } from "./tool-benchmark/config.js";
import { runCoreSuite } from "./tool-benchmark/core-suite.js";
import { createCoreFixture, createHeavyFixture } from "./tool-benchmark/fixtures.js";
import { runHardSuite } from "./tool-benchmark/hard-suite.js";
import type { BenchmarkResult } from "./tool-benchmark/harness.js";
import { type Comparison, compare, geometricMean, printTable } from "./tool-benchmark/report.js";
import { diffFingerprints, fingerprintHardSuite } from "./tool-benchmark/verify.js";

/**
 * Runs both executors over identical fixtures and reports the difference.
 *
 * `--suite core` (the default, and what CI gates on) is the ten tool calls at
 * everyday sizes. `--suite hard` is the same ten under load: multi-megabyte
 * files, full-corpus scans, binary the search has to decline, multi-byte output
 * and concurrent bursts. `--suite all` runs both and reports them separately,
 * because averaging a 4 KB read into an 8 MB one hides the answer.
 */

const ROOT = import.meta.dirname;
const QUICK = process.argv.includes("--quick");
const CHECK = process.argv.includes("--check");
const JSON_OUTPUT = process.argv.includes("--json");
const SKIP_VERIFY = process.argv.includes("--no-verify");
/** Prints what both engines answered and stops, without timing anything. */
const VERIFY_ONLY = process.argv.includes("--verify");
const SUITES = requestedSuites();

function requestedSuites(): Suite[] {
  const flag = process.argv.indexOf("--suite");
  const value = flag < 0 ? "core" : process.argv[flag + 1];
  if (value === "core" || value === undefined) return ["core"];
  if (value === "hard") return ["hard"];
  if (value === "all") return ["core", "hard"];
  throw new Error(`Unknown suite: ${value}. Expected core, hard or all.`);
}

async function runSuite(suite: Suite): Promise<Comparison[]> {
  const heavy = suite === "hard";
  const create = heavy ? createHeavyFixture : createCoreFixture;
  const typescriptRoot = await create(`exeora-ts-${suite}-`);
  const rustRoot = await create(`exeora-rust-${suite}-`);

  try {
    if (heavy && (VERIFY_ONLY || !SKIP_VERIFY)) await verifyHardSuite(typescriptRoot, rustRoot);
    if (VERIFY_ONLY) return [];
    const typescript: BenchmarkResult = {
      engine: "typescript",
      cases: heavy
        ? await runHardSuite(typescriptRoot, QUICK)
        : await runCoreSuite(typescriptRoot, QUICK),
    };
    const rust = await benchmarkRust(suite, rustRoot);
    return compare(typescript, rust);
  } finally {
    killAllProcesses();
    await Promise.all([
      rm(typescriptRoot, { recursive: true, force: true }),
      rm(rustRoot, { recursive: true, force: true }),
    ]);
  }
}

/**
 * Refuses to time two engines that disagree about the answer.
 *
 * One call per case, per engine, reduced to a line. It costs a fraction of the
 * benchmark and is the difference between "Rust searched 4 MB of binary faster"
 * and "Rust never opened it".
 */
async function verifyHardSuite(typescriptRoot: string, rustRoot: string): Promise<void> {
  const typescript = await fingerprintHardSuite(typescriptRoot);
  const rust = JSON.parse(await runExample(rustRoot, ["--verify"]));
  const mismatches = diffFingerprints(typescript, rust);

  if (mismatches.length === 0) {
    if (JSON_OUTPUT) return;
    console.log(`Parity verified on ${Object.keys(typescript).length} hard cases.`);
    if (VERIFY_ONLY) {
      for (const [name, value] of Object.entries(typescript)) console.log(`  ${name}: ${value}`);
    }
    return;
  }
  for (const mismatch of mismatches) {
    console.error(
      `${mismatch.name}\n  typescript: ${mismatch.typescript}\n  rust:       ${mismatch.rust}`,
    );
  }
  throw new Error("The engines returned different results; the comparison would be meaningless.");
}

async function benchmarkRust(suite: Suite, root: string): Promise<BenchmarkResult> {
  return JSON.parse(await runExample(root, ["--suite", suite])) as BenchmarkResult;
}

async function runExample(root: string, extra: string[]): Promise<string> {
  await run("cargo", ["build", "--locked", "--release", "--example", "compare_tools"]);

  const arguments_ = [
    "run",
    "--quiet",
    "--locked",
    "--release",
    "--example",
    "compare_tools",
    "--",
    "--fixture",
    root,
    ...extra,
  ];
  if (QUICK) arguments_.push("--quick");
  return run("cargo", arguments_, true);
}

function run(command: string, arguments_: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: join(ROOT, ".."),
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

const report: Record<string, { comparisons: Comparison[]; geometricMean: number }> = {};
try {
  for (const suite of SUITES) {
    const comparisons = await runSuite(suite);
    if (comparisons.length === 0) continue;
    const mean = geometricMean(comparisons.map((result) => result.speedup));
    report[suite] = { comparisons, geometricMean: mean };

    if (!JSON_OUTPUT) printTable(`${suite} suite`, comparisons);
    if (CHECK && mean < 1) {
      console.error(
        `Rust regressed in the ${suite} suite: geometric mean speedup is ${mean.toFixed(2)}x (minimum 1.00x).`,
      );
      process.exitCode = 1;
    }
  }
  if (JSON_OUTPUT) console.log(JSON.stringify(report));
} finally {
  killAllProcesses();
}

import type { BenchmarkResult, CaseResult } from "./harness.js";

/**
 * Pairing and printing, with the cross-checks that make a pair meaningful.
 *
 * The two engines are separate processes running two hand-kept copies of the
 * same case list. Anything that could have drifted between them is checked
 * here, and a mismatch is an error rather than a footnote under a ratio.
 */

export interface Comparison {
  name: string;
  iterations: number;
  typescriptNs: number;
  rustNs: number;
  speedup: number;
}

export function compare(typescript: BenchmarkResult, rust: BenchmarkResult): Comparison[] {
  if (typescript.cases.length !== rust.cases.length) {
    throw new Error(
      `The engines ran different case counts: ${typescript.cases.length} and ${rust.cases.length}`,
    );
  }
  const rustCases = new Map(rust.cases.map((result) => [result.name, result]));

  return typescript.cases.map((tsCase) => {
    const rustCase = rustCases.get(tsCase.name);
    if (!rustCase) throw new Error(`Rust result is missing ${tsCase.name}`);
    assertComparable(tsCase, rustCase);
    return {
      name: tsCase.name,
      iterations: tsCase.iterations,
      typescriptNs: tsCase.medianNs,
      rustNs: rustCase.medianNs,
      speedup: tsCase.medianNs / rustCase.medianNs,
    };
  });
}

function assertComparable(typescript: CaseResult, rust: CaseResult): void {
  if (rust.iterations !== typescript.iterations || rust.samples !== typescript.samples) {
    throw new Error(`The engines used different sample settings for ${typescript.name}`);
  }
  if (!(typescript.medianNs > 0) || !(rust.medianNs > 0)) {
    throw new Error(`The engines reported an invalid duration for ${typescript.name}`);
  }
}

export function geometricMean(values: number[]): number {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

export function printTable(title: string, comparisons: Comparison[]): void {
  const mean = geometricMean(comparisons.map((result) => result.speedup));
  console.log(`\n### ${title}\n`);
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

function duration(nanoseconds: number): string {
  if (nanoseconds >= 1_000_000_000) return `${(nanoseconds / 1_000_000_000).toFixed(2)} s`;
  if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(2)} ms`;
  if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(2)} us`;
  return `${nanoseconds.toFixed(0)} ns`;
}

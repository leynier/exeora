/**
 * Fails when a source file is longer than the line budget.
 *
 * Ceiling is 500 lines for logic source (.ts, .tsx, .js, .py, .css, .sql, …).
 * Generated trees (dist, bin, public, …) and docs are skipped.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MAX_LINES = 500;

const SKIP_DIRS = new Set([
  ".git",
  ".astro",
  ".vite",
  ".wrangler",
  "bin",
  "dist",
  "docs",
  "node_modules",
  "public",
  "__pycache__",
]);

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".sql"]);

function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  if (text.endsWith("\n")) lines--;
  return lines;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = name.slice(dot).toLowerCase();
    if (!SOURCE_EXT.has(ext)) continue;
    if (name.endsWith(".d.ts")) continue;
    out.push(full);
  }
}

const files: string[] = [];
walk(ROOT, files);

const errors: string[] = [];

for (const full of files.sort()) {
  const lines = lineCount(full);
  if (lines <= MAX_LINES) continue;
  const rel = relative(ROOT, full).split(sep).join("/");
  errors.push(`${rel}: ${lines} lines — max is ${MAX_LINES}`);
}

if (errors.length > 0) {
  console.error(`File length check failed (${errors.length}):\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`File length check passed (${files.length} files, max ${MAX_LINES}).`);

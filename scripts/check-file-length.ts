/**
 * Fails when a source file grows past the line budget.
 *
 * Soft ceiling is 500 lines for logic source. Files already over that live in
 * `OVERSIZED` with their current length: they may not grow, and once they drop
 * to 500 or under they must leave the list. Shrinking debt is a separate task;
 * this script only keeps it from getting worse.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MAX_LINES = 500;

/** Paths relative to the repo root, with the line count they are allowed to keep. */
const OVERSIZED: Record<string, number> = {
  "apps/gateway/src/api/index.ts": 950,
  "apps/gateway/src/api/clients.workers.test.ts": 825,
  "apps/gateway/src/index.ts": 864,
  "apps/gateway/src/mcp.workers.test.ts": 696,
  "apps/gateway/src/oauth/pages.ts": 516,
  "apps/gateway/src/relay-do.ts": 580,
  "apps/gateway/src/relay-do.workers.test.ts": 744,
  "apps/gateway/src/clients.ts": 557,
  "packages/cli/src/index.ts": 949,
  "packages/protocol/src/tools.ts": 538,
};

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
const seenAllow = new Set<string>();

for (const full of files.sort()) {
  const rel = relative(ROOT, full).split(sep).join("/");
  const lines = lineCount(full);
  const allowed = OVERSIZED[rel];

  if (allowed !== undefined) {
    seenAllow.add(rel);
    if (lines <= MAX_LINES) {
      errors.push(
        `${rel}: ${lines} lines — under ${MAX_LINES}; remove it from OVERSIZED in scripts/check-file-length.ts`,
      );
    } else if (lines > allowed) {
      errors.push(
        `${rel}: ${lines} lines — oversized budget is ${allowed}; split before growing further`,
      );
    }
    continue;
  }

  if (lines > MAX_LINES) {
    errors.push(`${rel}: ${lines} lines — max is ${MAX_LINES}`);
  }
}

for (const rel of Object.keys(OVERSIZED).sort()) {
  if (!seenAllow.has(rel)) {
    errors.push(
      `${rel}: listed in OVERSIZED but missing on disk — remove the entry from scripts/check-file-length.ts`,
    );
  }
}

if (errors.length > 0) {
  console.error(`File length check failed (${errors.length}):\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `File length check passed (${files.length} files, max ${MAX_LINES}, ${Object.keys(OVERSIZED).length} oversized exemptions).`,
);

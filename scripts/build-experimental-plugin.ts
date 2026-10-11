import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildExperimentalPluginBundle } from "./experimental-plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const { archive, sha256, version, files } = buildExperimentalPluginBundle(root);
// Versioned output preserves the first reviewed and delivered fixture.
const output = resolve(root, ".artifacts/experimental-plugin", version);
mkdirSync(output, { recursive: true, mode: 0o700 });
chmodSync(output, 0o700);
const filename = "exeora-combined-experimental.zip";
writeFileSync(resolve(output, filename), archive, { mode: 0o600 });
writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`, { mode: 0o600 });
writeFileSync(
  resolve(output, "package.json"),
  `${JSON.stringify({ experimental: true, version, bytes: archive.length, sha256, files }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`${resolve(output, filename)}\n${archive.length} bytes\nSHA-256 ${sha256}`);

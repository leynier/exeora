import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildClaudePluginBundle,
  CLAUDE_PLUGIN_DOWNLOAD,
  CLAUDE_PLUGIN_METADATA,
  CLAUDE_PLUGIN_ZIP,
} from "./claude-plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/web/landing/public/downloads");
const { archive, sha256, version, files } = buildClaudePluginBundle(root);
mkdirSync(output, { recursive: true });
for (const download of [CLAUDE_PLUGIN_ZIP, CLAUDE_PLUGIN_DOWNLOAD]) {
  const filename = download.split("/").at(-1) as string;
  writeFileSync(resolve(output, filename), archive);
  writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
}
writeFileSync(
  resolve(output, CLAUDE_PLUGIN_METADATA.split("/").at(-1) as string),
  `${JSON.stringify({ name: "exeora-workspaces", version, bytes: archive.length, sha256, download: CLAUDE_PLUGIN_DOWNLOAD, zip: CLAUDE_PLUGIN_ZIP }, null, 2)}\n`,
);
console.log(
  `Exeora Claude plugin ${version}: ${files.length} files, ${archive.length} bytes (${sha256})`,
);

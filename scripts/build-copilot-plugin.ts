import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCopilotPluginBundle,
  COPILOT_PLUGIN_DOWNLOAD,
  COPILOT_PLUGIN_LABEL,
  COPILOT_PLUGIN_METADATA,
} from "./copilot-plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/web/landing/public/downloads");
const { archive, sha256, version, files } = buildCopilotPluginBundle(root);
const filename = COPILOT_PLUGIN_DOWNLOAD.split("/").at(-1) as string;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, filename), archive);
writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
writeFileSync(
  resolve(output, COPILOT_PLUGIN_METADATA.split("/").at(-1) as string),
  `${JSON.stringify({ name: "exeora-copilot", displayName: COPILOT_PLUGIN_LABEL, version, bytes: archive.length, sha256, download: COPILOT_PLUGIN_DOWNLOAD }, null, 2)}\n`,
);
console.log(
  `${COPILOT_PLUGIN_LABEL} ${version}: ${files.length} files, ${archive.length} bytes (${sha256})`,
);

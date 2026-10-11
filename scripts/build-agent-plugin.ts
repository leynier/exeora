import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_PLUGIN_DOWNLOAD,
  AGENT_PLUGIN_LABEL,
  AGENT_PLUGIN_METADATA,
  buildAgentPluginBundle,
} from "./agent-plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/web/landing/public/downloads");
const { archive, sha256, version, files } = buildAgentPluginBundle(root);
const filename = AGENT_PLUGIN_DOWNLOAD.split("/").at(-1) as string;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, filename), archive);
writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
// Distribution label lives outside the pure ZIP; it is not a portable manifest field.
writeFileSync(
  resolve(output, AGENT_PLUGIN_METADATA.split("/").at(-1) as string),
  `${JSON.stringify({ name: "exeora-agent-plugin", displayName: AGENT_PLUGIN_LABEL, version, bytes: archive.length, sha256, download: AGENT_PLUGIN_DOWNLOAD }, null, 2)}\n`,
);
console.log(
  `${AGENT_PLUGIN_LABEL} ${version}: ${files.length} files, ${archive.length} bytes (${sha256})`,
);

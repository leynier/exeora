import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCursorPluginBundle,
  CURSOR_PLUGIN_DOWNLOAD,
  CURSOR_PLUGIN_LABEL,
  CURSOR_PLUGIN_METADATA,
} from "./cursor-plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/web/landing/public/downloads");
const { archive, sha256, version, files } = buildCursorPluginBundle(root);
const filename = CURSOR_PLUGIN_DOWNLOAD.split("/").at(-1) as string;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, filename), archive);
writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
writeFileSync(
  resolve(output, CURSOR_PLUGIN_METADATA.split("/").at(-1) as string),
  `${JSON.stringify({ name: "grokbot-cursor", displayName: CURSOR_PLUGIN_LABEL, version, bytes: archive.length, sha256, download: CURSOR_PLUGIN_DOWNLOAD }, null, 2)}\n`,
);
console.log(
  `${CURSOR_PLUGIN_LABEL} ${version}: ${files.length} files, ${archive.length} bytes (${sha256})`,
);

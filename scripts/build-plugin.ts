import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPluginBundle, PLUGIN_DOWNLOAD } from "./plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/web/landing/public/downloads");
const { archive, sha256, version, files } = buildPluginBundle(root);
const filename = PLUGIN_DOWNLOAD.split("/").at(-1) as string;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, filename), archive);
writeFileSync(resolve(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
writeFileSync(
  resolve(output, "exeora-plugin.json"),
  `${JSON.stringify({ name: "exeora", version, bytes: archive.length, sha256, download: PLUGIN_DOWNLOAD }, null, 2)}\n`,
);
console.log(`Exeora plugin ${version}: ${files.length} files, ${archive.length} bytes (${sha256})`);

import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { validateOpenAIUploadContents } from "./openai-submission-package.js";
import { buildPluginBundle } from "./plugin-bundle.js";

const bundle = buildPluginBundle(resolve(import.meta.dirname, ".."));
validateOpenAIUploadContents(unzipSync(bundle.archive));
console.log(`Local OpenAI package checks passed: ${bundle.version}, SHA-256 ${bundle.sha256}`);
console.log("Imported MCP remains Desktop only. No upload, scan, OAuth or publication performed.");
console.log("Public web release still needs publisher access/identity, MCP/domain verification,");
console.log(
  "real test cases and reviewer materials, portal scans/review, approval and publication.",
);

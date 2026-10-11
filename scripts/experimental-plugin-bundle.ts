import { unzipSync } from "fflate";
import { buildAgentPluginBundle } from "./agent-plugin-bundle.js";
import { validateAgentPluginDocuments } from "./agent-plugin-schemas.js";
import { buildClaudePluginBundle } from "./claude-plugin-bundle.js";
import { buildCopilotPluginBundle } from "./copilot-plugin-bundle.js";
import { buildCursorPluginBundle } from "./cursor-plugin-bundle.js";
import { buildPluginBundle } from "./plugin-bundle.js";
import { archivePluginPackage, packageJson, validatePackageSkills } from "./plugin-package.js";

export const EXPERIMENTAL_VERSION = "0.0.0-experimental.2";

/** A mixed-root fixture for preliminary parser tests, never a production download. */
export function buildExperimentalPluginBundle(root: string) {
  const portable = unzipSync(buildAgentPluginBundle(root).archive);
  const chatgpt = unzipSync(buildPluginBundle(root).archive);
  const claude = unzipSync(buildClaudePluginBundle(root).archive);
  const cursor = unzipSync(buildCursorPluginBundle(root).archive);
  // Validate the independent Copilot distribution as well; its standard components
  // are represented here by the shared core. No unsupported namespace data is invented.
  buildCopilotPluginBundle(root);
  const entries: Record<string, Uint8Array> = { ...portable };
  const json = (path: string, value: unknown) => {
    entries[path] = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  };
  const manifest = packageJson(portable, "plugin.json");
  manifest.name = "exeora-combined-experimental";
  manifest.version = EXPERIMENTAL_VERSION;
  manifest.description = "EXPERIMENTAL mixed-format Exeora fixture. Not a universal installer.";
  manifest.extensions = packageJson(chatgpt, "plugin.json").extensions;
  manifest.extensions["com.openai"].interface.displayName = "Exeora Experimental";
  json("plugin.json", manifest);
  for (const path of ["assets/icon.png", "assets/logo.png"]) entries[path] = chatgpt[path];
  const claudeManifest = packageJson(claude, ".claude-plugin/plugin.json");
  claudeManifest.name = "exeora-combined-experimental";
  claudeManifest.displayName = "Exeora Experimental";
  claudeManifest.version = EXPERIMENTAL_VERSION;
  json(".claude-plugin/plugin.json", claudeManifest);
  entries[".mcp.json"] = claude[".mcp.json"];
  const cursorManifest = packageJson(cursor, ".cursor-plugin/plugin.json");
  cursorManifest.version = EXPERIMENTAL_VERSION;
  cursorManifest.description =
    "EXPERIMENTAL GrokBot Cursor mixed-format fixture; parser precedence unverified.";
  cursorManifest.mcpServers = "cursor.mcp.json";
  json(".cursor-plugin/plugin.json", cursorManifest);
  entries["cursor.mcp.json"] = cursor["mcp.json"];
  entries["README.md"] = Buffer.from(
    `# Exeora combined EXPERIMENTAL fixture\n\nThis private preliminary ZIP combines a root Agent Plugins 1.0 manifest/MCP (also used by GitHub Copilot), the documented OpenAI extension, a Claude manifest/MCP and a Cursor manifest/native MCP path. Three portable skills are shared. It does not replace any of the five separate production packages.\n\n| Client | Expected interpretation and limits |\n| --- | --- |\n| Agent Plugins core | Root plugin.json/mcp.json validate against 1.0.0 schemas. Unsupported extensions are ignored by conformant clients. This combined package is not the pure no-extension distribution. |\n| ChatGPT | Imported MCP declarations classify this package as Desktop only even though the endpoint is remote HTTPS. Public ChatGPT web distribution requires the publisher portal connection, scans, review and publication; extra manifests are not the verified cause. |\n| Claude web | The user reports preliminary Claude web import/use success for one of three unknown experimental ZIPs. This does not identify this fixture or prove OAuth. The API single-manifest requirement does not establish that alternate provider files always cause web rejection. CLI validation cannot establish web acceptance; the separate Claude package remains the production distribution. |\n| Cursor / Grok Bot | Cursor has two supported format markers here; the reference does not specify mixed-marker priority. Its Cursor manifest points to cursor.mcp.json to avoid native/portable MCP conflicts if that manifest is selected. Grok Bot custom ZIP/repo import is not documented. Both remain unverified. |\n| GitHub Copilot | The CLI reference gives root Agent Plugins manifest priority over legacy .claude-plugin/plugin.json. Copilot uses the shared portable skills/MCP; no image/interface extension is invented. App/VS Code acceptance must be tested separately. |\n\nAll connections point to https://exeora.dev/mcp without credentials. Package/schema/read-only parser tests are not installation, tool execution or real OAuth. No secrets, account grants or persistent permissions are changed. Do not submit this as a production or universally compatible archive. No Kiro implementation is included.\n\nSources: https://agent-plugins.org/specification ; https://developers.openai.com/plugins/build/plugins ; https://learn.chatgpt.com/docs/enterprise/plugin-management ; https://developers.openai.com/plugins/deploy/submission ; https://platform.claude.com/docs/en/manage-claude/plugins-api ; https://cursor.com/docs/reference/plugins ; https://cursor.com/help/grok-bot/connect-plugins ; https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference\n`,
  );
  validateAgentPluginDocuments(manifest, packageJson(entries, "mcp.json"));
  validatePackageSkills(entries);
  return archivePluginPackage(entries, EXPERIMENTAL_VERSION);
}

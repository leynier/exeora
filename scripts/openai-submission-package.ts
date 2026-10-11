import { validateAgentPluginDocuments } from "./agent-plugin-schemas.js";
import { packageJson } from "./plugin-package.js";

/** Local preparation checks, not a replacement for OpenAI upload/review validation. */
export function validateOpenAIUploadContents(entries: Record<string, Uint8Array>): void {
  const manifest = packageJson(entries, "plugin.json");
  const mcp = packageJson(entries, "mcp.json");
  validateAgentPluginDocuments(manifest, mcp);
  const openai = manifest.extensions?.["com.openai"];
  if (!openai || typeof openai !== "object") throw new Error("Missing OpenAI presentation");
  if (
    "apps" in openai ||
    "hooks" in openai ||
    Object.keys(entries).some((path) => path.endsWith(".app.json") || path.startsWith("hooks/"))
  ) {
    throw new Error("Public submission does not support app references or lifecycle hooks");
  }
  const servers = Object.values(mcp.mcpServers) as Record<string, unknown>[];
  if (servers.length !== 1) throw new Error("Prepare exactly one remote MCP connection");
  const server = servers[0];
  if (server.type !== "streamable-http" || typeof server.url !== "string")
    throw new Error("Public submission needs remote HTTPS MCP");
  const endpoint = new URL(server.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("Public submission needs credential-free HTTPS MCP");
  if (server.headers && Object.keys(server.headers).length)
    throw new Error("Public submission rejects nonempty server headers");
  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    const value = openai.interface?.[field];
    if (typeof value !== "string") throw new Error(`Missing listing URL: ${field}`);
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(`Invalid listing URL: ${field}`);
  }
  for (const field of ["logo", "composerIcon"]) {
    const path = openai.interface?.[field];
    if (typeof path !== "string" || !path.startsWith("./assets/") || path.includes(".."))
      throw new Error(`Unsafe listing asset: ${field}`);
    if (!entries[path.slice(2)]) throw new Error(`Missing listing asset: ${field}`);
  }
}

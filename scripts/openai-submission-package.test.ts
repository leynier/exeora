import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validateOpenAIUploadContents } from "./openai-submission-package.js";
import { buildPluginBundle } from "./plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");
const contents = () => unzipSync(buildPluginBundle(root).archive);
type EditableDocument = {
  extensions: Record<string, Record<string, unknown>>;
  mcpServers: Record<string, Record<string, unknown>>;
};
function edit(
  entries: Record<string, Uint8Array>,
  path: string,
  mutate: (json: EditableDocument) => void,
) {
  const json = JSON.parse(Buffer.from(entries[path]).toString());
  mutate(json);
  entries[path] = Buffer.from(JSON.stringify(json));
}

describe("OpenAI public submission preparation", () => {
  it("preserves the shipped archive and checks its portable remote package", () => {
    expect(buildPluginBundle(root).sha256).toBe(
      "7f289d690baacd71b1dd8c17a6d0e7602877e248517f78601e1815406aa9cb97",
    );
    expect(() => validateOpenAIUploadContents(contents())).not.toThrow();
  });

  it.each(["apps", "hooks"])("rejects unsupported submission component %s", (field) => {
    const entries = contents();
    edit(entries, "plugin.json", (json) => {
      json.extensions["com.openai"][field] = field === "apps" ? "./.app.json" : "./hooks/";
    });
    expect(() => validateOpenAIUploadContents(entries)).toThrow("does not support");
  });

  it("rejects credentials in an otherwise schema-valid endpoint", () => {
    const entries = contents();
    edit(entries, "mcp.json", (json) => {
      json.mcpServers.exeora.url = "https://user:password@exeora.dev/mcp";
    });
    expect(() => validateOpenAIUploadContents(entries)).toThrow("credential-free");
  });

  it("requires the listing asset and excludes bearer-header workarounds", () => {
    const entries = contents();
    delete entries["assets/logo.png"];
    expect(() => validateOpenAIUploadContents(entries)).toThrow("Missing listing asset");
    const withHeader = contents();
    edit(withHeader, "mcp.json", (json) => {
      json.mcpServers.exeora.headers = { Authorization: "Bearer test-only-not-a-real-token" };
    });
    expect(() => validateOpenAIUploadContents(withHeader)).toThrow("nonempty server headers");
  });
});

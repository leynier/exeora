import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildClaudePluginBundle } from "./claude-plugin-bundle.js";
import { buildPluginBundle } from "./plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");

function fixture(run: (root: string) => void) {
  const temporary = mkdtempSync(join(tmpdir(), "exeora-claude-plugin-"));
  try {
    cpSync(join(root, "plugins/exeora-claude"), join(temporary, "plugins/exeora-claude"), {
      recursive: true,
    });
    cpSync(join(root, "LICENSE"), join(temporary, "LICENSE"));
    run(temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function mutateJson(root: string, path: string, edit: (json: Record<string, unknown>) => void) {
  const absolute = join(root, "plugins/exeora-claude", path);
  const json = JSON.parse(readFileSync(absolute, "utf8"));
  edit(json);
  writeFileSync(absolute, JSON.stringify(json));
}

describe("Claude web plugin", () => {
  it("builds a reproducible web upload with a single root manifest, remote connector and adapted skills", () => {
    const first = buildClaudePluginBundle(root);
    expect(buildClaudePluginBundle(root).archive).toEqual(first.archive);
    const entries = unzipSync(first.archive);
    const json = (path: string) => JSON.parse(Buffer.from(entries[path]).toString("utf8"));
    const manifest = json(".claude-plugin/plugin.json");
    expect(manifest).toMatchObject({
      name: "exeora-workspaces",
      version: first.version,
      displayName: "Exeora",
    });
    expect(json(".mcp.json")).toEqual({
      mcpServers: { exeora: { type: "http", url: "https://exeora.dev/mcp" } },
    });
    expect(entries[manifest.icon.slice(2)]).toBeDefined();
    expect(Object.keys(entries).filter((path) => path.endsWith("plugin.json"))).toEqual([
      ".claude-plugin/plugin.json",
    ]);
    expect(Object.keys(entries).filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(3);
    expect(
      Object.keys(entries).some((path) =>
        /\.env|\.dev\.vars|node_modules|^bin\/|^apps\/|\.zip$|\.yaml$/.test(path),
      ),
    ).toBe(false);
    expect(entries.LICENSE).toBeDefined();
    expect(Buffer.from(entries["README.md"]).toString()).toContain(
      "Customize > Plugins > Add > Upload plugin",
    );
    expect(Buffer.from(entries["skills/exeora-setup/SKILL.md"]).toString()).toContain(
      "does not add the connector or sign the user in",
    );
  });

  it("keeps the released ChatGPT 1.0.0 archive unchanged while building Claude independently", () => {
    const before = buildPluginBundle(root);
    buildClaudePluginBundle(root);
    expect(buildPluginBundle(root).archive).toEqual(before.archive);
    expect(before.version).toBe("1.0.0");
    expect(before.sha256).toBe("7f289d690baacd71b1dd8c17a6d0e7602877e248517f78601e1815406aa9cb97");
  });

  it.each([
    { type: "stdio", command: "node", args: ["server.js"] },
    {
      type: "http",
      url: "https://exeora.dev/mcp",
      headers: { Authorization: "Bearer not-for-distribution" },
    },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude config interpolation is deliberately rejected.
    { type: "http", url: "https://${user_config.host}/mcp" },
    {
      type: "http",
      url: "https://exeora.dev/mcp",
      oauth: { clientId: "cli-only", callbackPort: 8080 },
    },
  ])("rejects local, credential-bearing and CLI-only connection configuration: %j", (server) => {
    fixture((root) => {
      mutateJson(root, ".mcp.json", (mcp) => {
        mcp.mcpServers = { exeora: server };
      });
      expect(() => buildClaudePluginBundle(root)).toThrow("fixed credential-free");
    });
  });

  it("rejects symlinked files and directories rather than reading outside the package", () => {
    for (const path of ["assets/outside.svg", "skills/outside"]) {
      fixture((root) => {
        symlinkSync(
          path.endsWith(".svg") ? join(root, "LICENSE") : root,
          join(root, "plugins/exeora-claude", path),
        );
        expect(() => buildClaudePluginBundle(root)).toThrow("Symlink");
      });
    }
  });

  it("rejects unexpected resources, missing icon, unknown manifest fields and invalid skill YAML", () => {
    fixture((root) => {
      writeFileSync(join(root, "plugins/exeora-claude/assets/.env"), "SECRET=not-for-distribution");
      expect(() => buildClaudePluginBundle(root)).toThrow("Unexpected Claude plugin resource");
    });
    fixture((root) => {
      mutateJson(root, ".claude-plugin/plugin.json", (manifest) => {
        manifest.icon = "./assets/missing.png";
      });
      expect(() => buildClaudePluginBundle(root)).toThrow("Missing Claude listing icon");
    });
    fixture((root) => {
      mutateJson(root, ".claude-plugin/plugin.json", (manifest) => {
        manifest.extensions = { "com.openai": {} };
      });
      expect(() => buildClaudePluginBundle(root)).toThrow("Unexpected Claude manifest field");
    });
    fixture((root) => {
      writeFileSync(
        join(root, "plugins/exeora-claude/skills/exeora-setup/SKILL.md"),
        "---\nname: exeora-setup\ndescription: <example>invalid</example>\n---\n",
      );
      expect(() => buildClaudePluginBundle(root)).toThrow("Invalid Claude skill metadata");
    });
  });
});

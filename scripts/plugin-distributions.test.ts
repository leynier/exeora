import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildAgentPluginBundle } from "./agent-plugin-bundle.js";
import { validateAgentPluginDocuments } from "./agent-plugin-schemas.js";
import { buildClaudePluginBundle } from "./claude-plugin-bundle.js";
import { buildCopilotPluginBundle } from "./copilot-plugin-bundle.js";
import { buildCursorPluginBundle } from "./cursor-plugin-bundle.js";
import { buildExperimentalPluginBundle } from "./experimental-plugin-bundle.js";
import { buildPluginBundle } from "./plugin-bundle.js";
import mcpSchema from "./schemas/agent-plugins-1.0.0/mcp.schema.json";
import pluginSchema from "./schemas/agent-plugins-1.0.0/plugin.schema.json";

const root = resolve(import.meta.dirname, "..");
const json = (entries: Record<string, Uint8Array>, path: string) =>
  JSON.parse(Buffer.from(entries[path]).toString());
const distributions = [
  {
    folder: "exeora-cursor",
    build: buildCursorPluginBundle,
    manifest: ".cursor-plugin/plugin.json",
    name: "grokbot-cursor",
  },
  {
    folder: "exeora-agent",
    build: buildAgentPluginBundle,
    manifest: "plugin.json",
    name: "exeora-agent-plugin",
  },
  {
    folder: "exeora-copilot",
    build: buildCopilotPluginBundle,
    manifest: "plugin.json",
    name: "exeora-copilot",
  },
];

function fixture(run: (root: string) => void) {
  const temporary = mkdtempSync(join(tmpdir(), "exeora-distributions-"));
  try {
    for (const path of [
      "plugins",
      ".cursor-plugin",
      ".github/plugin",
      ".agents/plugins",
      "LICENSE",
    ]) {
      cpSync(join(root, path), join(temporary, path), { recursive: true });
    }
    run(temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function editJson(
  root: string,
  folder: string,
  path: string,
  edit: (json: Record<string, unknown>) => void,
) {
  const file = join(root, "plugins", folder, path);
  const json = JSON.parse(readFileSync(file, "utf8"));
  edit(json);
  writeFileSync(file, JSON.stringify(json));
}

describe("independent Exeora distributions", () => {
  it.each(distributions)(
    "builds $name reproducibly with three safe skills and one manifest",
    ({ build, manifest, name }) => {
      const first = build(root);
      expect(build(root).archive).toEqual(first.archive);
      const entries = unzipSync(first.archive);
      expect(json(entries, manifest).name).toBe(name);
      expect(Object.keys(entries).filter((path) => path.endsWith("plugin.json"))).toEqual([
        manifest,
      ]);
      expect(Object.keys(entries).filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(3);
      expect(entries.LICENSE).toBeDefined();
      expect(Buffer.from(entries["skills/exeora-project/SKILL.md"]).toString()).toContain(
        "APPROVAL_DECLINED",
      );
      expect(Buffer.from(entries["skills/exeora-setup/SKILL.md"]).toString()).toContain(
        "Keep the project/workspace selectors",
      );
      expect(
        Object.keys(entries).some((path) => /\.env|\.yaml$|node_modules|^apps\//.test(path)),
      ).toBe(false);
    },
  );

  it("preserves all five archives when the sixth experimental bundle is built", () => {
    const builders = [
      buildPluginBundle,
      buildClaudePluginBundle,
      ...distributions.map(({ build }) => build),
    ];
    const before = builders.map((build) => build(root));
    buildExperimentalPluginBundle(root);
    builders.forEach((build, index) => {
      expect(build(root).archive).toEqual(before[index].archive);
    });
    expect(before[0].sha256).toBe(
      "7f289d690baacd71b1dd8c17a6d0e7602877e248517f78601e1815406aa9cb97",
    );
    expect(before[1].sha256).toBe(
      "cd9b36c69b01186ecc81857cd47c3f82d93335a9eecb76e587c4cf5c3d1dfd16",
    );
    expect(new Set(before.map(({ sha256 }) => sha256)).size).toBe(5);
  });

  it("keeps the Agent Plugin pure and the other formats' metadata in their own archives", () => {
    const entries = unzipSync(buildAgentPluginBundle(root).archive);
    expect(Object.keys(entries).sort()).toEqual([
      "LICENSE",
      "README.md",
      "mcp.json",
      "plugin.json",
      "skills/exeora-project/SKILL.md",
      "skills/exeora-setup/SKILL.md",
      "skills/exeora-workspace/SKILL.md",
    ]);
    expect(json(entries, "plugin.json")).not.toHaveProperty("extensions");
    const text = Object.entries(entries)
      .filter(([path]) => path !== "LICENSE")
      .map(([, bytes]) => Buffer.from(bytes).toString())
      .join("\n");
    expect(text).not.toMatch(
      /com\.openai|com\.cursor|com\.github|\.claude-plugin|\.cursor-plugin|displayName|"interface"|ChatGPT|Claude|GrokBot|Copilot/,
    );
    const cursor = unzipSync(buildCursorPluginBundle(root).archive);
    expect(json(cursor, ".cursor-plugin/plugin.json").displayName).toBe("GrokBot Cursor");
    expect(cursor["assets/logo.png"]).toEqual(
      unzipSync(buildClaudePluginBundle(root).archive)["assets/logo.png"],
    );
    const copilot = unzipSync(buildCopilotPluginBundle(root).archive);
    expect(json(copilot, "plugin.json")).not.toHaveProperty("extensions");
    expect(Buffer.from(copilot["README.md"]).toString()).toContain("![Exeora](assets/logo.png)");
  });

  it("pins the canonical official schemas by semantic digest, not just copied schema identifiers", () => {
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(digest(pluginSchema)).toBe(
      "d9a49839afcbce02858fe55ac64a844b002a9a588e9db1b31ebd72256bc61b8d",
    );
    expect(digest(mcpSchema)).toBe(
      "fc7a2a253ba117726bfdca51229ca98d103b4616c5f25c5a941563c0493faeeb",
    );
  });

  it.each(["displayName", "logo", "interface", "skills", "mcpServers"])(
    "rejects nonstandard root field %s via the official schema",
    (field) => {
      fixture((root) => {
        editJson(root, "exeora-agent", "plugin.json", (manifest) => {
          manifest[field] = "unsupported";
        });
        expect(() => buildAgentPluginBundle(root)).toThrow("Agent plugin schema");
      });
    },
  );

  it.each(["com.openai", "com.cursor", "com.github.copilot"])(
    "rejects extension %s even though the standard schema permits extensions",
    (namespace) => {
      fixture((root) => {
        editJson(root, "exeora-agent", "plugin.json", (manifest) => {
          manifest.extensions = { [namespace]: {} };
        });
        expect(() => buildAgentPluginBundle(root)).toThrow("cannot contain extensions");
        mkdirSync(join(root, "plugins/exeora-agent", namespace));
        expect(() => buildAgentPluginBundle(root)).toThrow("Unexpected plugin directory");
      });
    },
  );

  it.each(distributions)(
    "rejects secret/native MCP fields and filesystem escapes for $name",
    ({ folder, build }) => {
      fixture((root) => {
        editJson(root, folder, "mcp.json", (mcp) => {
          mcp.mcpServers = {
            exeora: {
              url: "https://exeora.dev/mcp",
              type: "streamable-http",
              headers: { Authorization: "Bearer not-for-distribution" },
            },
          };
        });
        expect(() => build(root)).toThrow("credential-free");
      });
      fixture((root) => {
        symlinkSync(root, join(root, "plugins", folder, "skills/outside"));
        expect(() => build(root)).toThrow("Symlink");
      });
      fixture((root) => {
        writeFileSync(join(root, "plugins", folder, ".env"), "SECRET=not-for-distribution");
        expect(() => build(root)).toThrow("Unexpected plugin resource");
      });
    },
  );

  it.each(["http", "stdio", "unknown"])(
    "does not accept a native or unsupported transport %s as a pure remote package",
    (type) => {
      fixture((root) => {
        editJson(root, "exeora-agent", "mcp.json", (mcp) => {
          mcp.mcpServers = { exeora: { type, url: "https://exeora.dev/mcp" } };
        });
        expect(() => buildAgentPluginBundle(root)).toThrow("Agent MCP schema");
      });
    },
  );

  it("rejects guessed Copilot image namespace fields and incorrect catalog paths", () => {
    fixture((root) => {
      editJson(root, "exeora-copilot", "plugin.json", (manifest) => {
        manifest.extensions = { "com.github.copilot": { interface: { logo: "assets/logo.png" } } };
      });
      expect(() => buildCopilotPluginBundle(root)).toThrow("Unsupported Copilot extension");
    });
    fixture((root) => {
      const file = join(root, ".cursor-plugin/marketplace.json");
      const catalog = JSON.parse(readFileSync(file, "utf8"));
      catalog.plugins[0].source = "plugins/exeora";
      writeFileSync(file, JSON.stringify(catalog));
      expect(() => buildCursorPluginBundle(root)).toThrow("marketplace mapping");
    });
  });

  it("keeps the mixed-format example experimental, shares portable skills and documents its import limits", () => {
    const first = buildExperimentalPluginBundle(root);
    expect(buildExperimentalPluginBundle(root).archive).toEqual(first.archive);
    const entries = unzipSync(first.archive);
    expect(first.version).toBe("0.0.0-experimental.2");
    expect(Object.keys(entries).filter((path) => path.endsWith("plugin.json"))).toHaveLength(3);
    expect(Object.keys(entries).filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(3);
    expect(() =>
      validateAgentPluginDocuments(json(entries, "plugin.json"), json(entries, "mcp.json")),
    ).not.toThrow();
    expect(json(entries, ".cursor-plugin/plugin.json").mcpServers).toBe("cursor.mcp.json");
    expect(Buffer.from(entries["README.md"]).toString()).toContain("Desktop only");
    expect(readFileSync(join(root, "apps/web/package.json"), "utf8")).not.toContain(
      "build-experimental-plugin",
    );
  });
});

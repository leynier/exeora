import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildPluginBundle } from "./plugin-bundle.js";

const root = resolve(import.meta.dirname, "..");

function fixture(run: (root: string) => void) {
  const temporary = mkdtempSync(join(tmpdir(), "exeora-plugin-"));
  try {
    for (const path of ["plugins", ".agents/plugins", "LICENSE"]) {
      cpSync(join(root, path), join(temporary, path), { recursive: true });
    }
    run(temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe("downloadable plugin", () => {
  it("packages portable components and a self-contained local installation source reproducibly", () => {
    const first = buildPluginBundle(root);
    const second = buildPluginBundle(root);
    expect(first.archive).toEqual(second.archive);
    expect(first.sha256).toBe(second.sha256);
    const files = unzipSync(first.archive);
    const json = (path: string) => JSON.parse(Buffer.from(files[path]).toString("utf8"));
    expect(json("plugin.json").version).toBe(first.version);
    expect(json("mcp.json").mcpServers.exeora).toEqual({
      type: "streamable-http",
      url: "https://exeora.dev/mcp",
    });
    const marketplace = json(".agents/plugins/marketplace.json");
    expect(marketplace.plugins[0].source.path).toBe("./");
    expect(marketplace.plugins[0].policy.authentication).toBe("ON_INSTALL");
    expect(Object.keys(files).filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(3);
    const extension = json("plugin.json").extensions["com.openai"];
    for (const path of [
      extension.onboardingSkill,
      extension.interface.composerIcon,
      extension.interface.logo,
    ]) {
      expect(files[path.slice(2)]).toBeDefined();
    }
    expect(
      Object.keys(files).some((path) => /\.env|\.dev\.vars|node_modules|^apps\//.test(path)),
    ).toBe(false);
    expect(files.LICENSE).toBeDefined();
  });

  it("rejects symlinks instead of following them outside the package", () => {
    fixture((root) => {
      symlinkSync(join(root, "LICENSE"), join(root, "plugins/exeora/assets/outside.md"));
      expect(() => buildPluginBundle(root)).toThrow("Not a regular plugin file");
    });
  });

  it("rejects missing manifest resources and unexpected files", () => {
    fixture((root) => {
      const path = join(root, "plugins/exeora/plugin.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.extensions["com.openai"].interface.logo = "./assets/missing.png";
      writeFileSync(path, JSON.stringify(manifest));
      expect(() => buildPluginBundle(root)).toThrow("Missing or unsafe plugin reference");
    });
    fixture((root) => {
      writeFileSync(join(root, "plugins/exeora/assets/.env"), "SECRET=not-for-distribution");
      expect(() => buildPluginBundle(root)).toThrow("Unexpected plugin resource");
    });
  });
});

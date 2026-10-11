import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { zipSync } from "fflate";

export const PLUGIN_DOWNLOAD = "/downloads/exeora-plugin.zip";

/** Package only maintained plugin resources, never the surrounding repository. */
export function pluginEntries(root: string): Record<string, Uint8Array> {
  const directory = join(root, "plugins/exeora");
  const entries: Record<string, Uint8Array> = {};

  function add(path: string): void {
    const absolute = join(directory, path);
    if (!lstatSync(absolute).isFile()) throw new Error(`Not a regular plugin file: ${path}`);
    entries[path] = new Uint8Array(readFileSync(absolute));
  }

  add("plugin.json");
  add("mcp.json");
  add("README.md");
  for (const path of ["assets", "skills"]) {
    function walk(relative: string): void {
      if (!lstatSync(join(directory, relative)).isDirectory()) {
        throw new Error(`Not a regular plugin directory: ${relative}`);
      }
      for (const name of readdirSync(join(directory, relative)).sort()) {
        const path = `${relative}/${name}`;
        const stat = lstatSync(join(directory, path));
        if (stat.isDirectory()) walk(path);
        else {
          if (!/\.(md|yaml|png|svg)$/.test(name)) {
            throw new Error(`Unexpected plugin resource: ${path}`);
          }
          add(path);
        }
      }
    }
    walk(path);
  }

  // Include the local catalog so the extracted ZIP is also an install source.
  const marketplace = JSON.parse(
    readFileSync(join(root, ".agents/plugins/marketplace.json"), "utf8"),
  );
  if (marketplace.plugins.length !== 1 || marketplace.plugins[0].name !== "exeora") {
    throw new Error("Expected the Exeora marketplace entry");
  }
  marketplace.plugins[0].source = { source: "local", path: "./" };
  entries[".agents/plugins/marketplace.json"] = Buffer.from(
    `${JSON.stringify(marketplace, null, 2)}\n`,
  );
  entries.LICENSE = new Uint8Array(readFileSync(join(root, "LICENSE")));

  const manifest = JSON.parse(Buffer.from(entries["plugin.json"]).toString("utf8"));
  const mcp = JSON.parse(Buffer.from(entries["mcp.json"]).toString("utf8"));
  if (manifest.name !== "exeora" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("The plugin needs its stable name and a release version");
  }
  if (
    !isDeepStrictEqual(mcp.mcpServers, {
      exeora: { type: "streamable-http", url: "https://exeora.dev/mcp" },
    })
  ) {
    throw new Error("The public plugin must use the credential-free Exeora account endpoint");
  }
  const extension = manifest.extensions["com.openai"];
  const paths = [
    extension.onboardingSkill,
    extension.interface.composerIcon,
    extension.interface.logo,
  ];
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      !path.startsWith("./") ||
      path.includes("..") ||
      !entries[path.slice(2)]
    ) {
      throw new Error(`Missing or unsafe plugin reference: ${path}`);
    }
  }
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.endsWith("/SKILL.md")) continue;
    const text = Buffer.from(bytes).toString("utf8");
    const name = path.split("/")[1];
    if (!text.startsWith(`---\nname: ${name}\ndescription: `) || !text.includes("\n---\n")) {
      throw new Error(`Invalid skill metadata: ${path}`);
    }
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, "en")));
}

export function buildPluginBundle(root: string) {
  const entries = pluginEntries(root);
  const manifest = JSON.parse(Buffer.from(entries["plugin.json"]).toString("utf8"));
  // Fixed local date fields: fflate encodes local fields, so this works across timezones.
  const archive = zipSync(entries, { level: 9, mtime: new Date(2000, 0, 1, 12) });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return { archive, sha256, version: manifest.version as string, files: Object.keys(entries) };
}

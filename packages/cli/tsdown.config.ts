import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "bin",
  clean: true,
  // @exeora/protocol resolves to TypeScript source inside the workspace, which
  // Node cannot load. Bundling it in is also what makes the published package
  // installable without the rest of the monorepo. Everything else stays
  // external so native modules (@napi-rs/keyring) keep their prebuilt binaries.
  noExternal: ["@exeora/protocol"],
});

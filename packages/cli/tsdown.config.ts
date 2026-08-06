import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "bin",
  clean: true,
  // Nothing imports this package, it is only ever executed, so declarations
  // would be dead weight in the tarball.
  dts: false,
  // Not read unless someone runs node with --enable-source-maps, which is
  // exactly what you ask a user for when their stack trace points into a
  // 45 kB bundle.
  sourcemap: true,
  // The one place the version is written down is package.json. It reaches the
  // gateway twice (device registration and the relay hello) and is reported by
  // --version, and three hand-maintained copies of it drifted the moment one
  // release forgot one.
  define: { __CLI_VERSION__: JSON.stringify(version) },
  // @exeora/protocol resolves to TypeScript source inside the workspace, which
  // Node cannot load. Bundling it in is also what makes the published package
  // installable without the rest of the monorepo. Everything else stays
  // external so native modules (@napi-rs/keyring) keep their prebuilt binaries.
  deps: { alwaysBundle: ["@exeora/protocol"] },
});

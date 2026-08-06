import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Runs these tests inside workerd, the same runtime as production, so the
 * Durable Object, its WebSocket hibernation behaviour and D1 are the real
 * implementations rather than stand-ins.
 *
 * `cloudflareTest` is a Vite plugin in @cloudflare/vitest-pool-workers 0.20;
 * the older `defineWorkersConfig` from `/config` no longer exists. In this
 * version `readD1Migrations` moved to the package root along with it.
 */

// Read in Node, handed to the tests as a binding, and applied by the setup
// file inside workerd. A test that reaches for D1 gets the real schema rather
// than a copy that drifts from `migrations/`.
//
// Resolved against this file rather than the working directory: vitest runs
// from the repository root, where `./migrations` is nothing.
const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    name: "gateway",
    include: ["src/**/*.workers.test.ts"],
    setupFiles: ["./test-setup.ts"],
  },
});

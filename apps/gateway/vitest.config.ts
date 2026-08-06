import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Runs these tests inside workerd, the same runtime as production, so the
 * Durable Object, its WebSocket hibernation behaviour and D1 are the real
 * implementations rather than stand-ins.
 *
 * `cloudflareTest` is a Vite plugin in @cloudflare/vitest-pool-workers 0.20;
 * the older `defineWorkersConfig` from `/config` no longer exists.
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    name: "gateway",
    include: ["src/**/*.workers.test.ts"],
  },
});

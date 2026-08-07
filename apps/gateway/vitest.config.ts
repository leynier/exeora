import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { CIMD_DOCUMENTS } from "./src/oauth/cimd-fixtures.js";

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

/**
 * Everything the Worker fetches from the outside world during a test.
 *
 * Only the Client ID Metadata Documents are served, because they are the only
 * outbound request any test makes. Anything else fails loudly rather than
 * reaching the network, which is the point: a test that silently depended on
 * chatgpt.com being up would be worse than no test.
 *
 * @cloudflare/vitest-pool-workers 0.20 dropped the `fetchMock` export from
 * `cloudflare:test`, so this is the interception point that remains, and it
 * works with the `global_fetch_strictly_public` flag the CIMD support needs.
 */
const outboundService = (request: Request): Response => {
  const document = CIMD_DOCUMENTS[request.url];
  if (document === undefined) {
    return new Response(`the workers tests do not reach the network: ${request.url}`, {
      status: 502,
    });
  }

  return new Response(JSON.stringify(document), {
    headers: { "content-type": "application/json" },
  });
};

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations }, outboundService },
    }),
  ],
  test: {
    name: "gateway",
    include: ["src/**/*.workers.test.ts"],
    setupFiles: ["./test-setup.ts"],
  },
});

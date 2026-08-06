import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Plain Node: the protocol contract, the local executor, and the parts
        // of the gateway that are ordinary functions (OAuth provider, session).
        test: {
          name: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/gateway/src/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/bin/**",
            // Belongs to the gateway project below: it needs workerd.
            "**/*.workers.test.ts",
          ],
        },
      },
      // Durable Objects and D1 have no meaningful stand-in outside workerd, so
      // those tests run in the real runtime.
      "./apps/gateway/vitest.config.ts",
    ],
  },
});

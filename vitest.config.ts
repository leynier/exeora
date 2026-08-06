import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `tsc --build` emits declaration output into dist/ purely for typechecking
    // — packages resolve each other through src/. Without this, vitest would
    // discover and run the compiled copy of every test a second time.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**", "**/.astro/**"],
  },
});

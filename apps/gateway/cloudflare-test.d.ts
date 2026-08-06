/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    /** Supplied by vitest.config.ts and applied in test-setup.ts. */
    TEST_MIGRATIONS: D1Migration[];
  }
}

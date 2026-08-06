/**
 * `Env` itself is generated from wrangler.jsonc by `wrangler types` into
 * worker-configuration.d.ts — rerun it after changing any binding.
 *
 * Secrets are not declared in wrangler.jsonc (that file is committed), so they
 * are merged into the generated interface here. Set them with
 * `wrangler secret put <NAME>` in production and in `.dev.vars` locally.
 */
declare global {
  interface Env {
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** Signing key for the cookie that approves an OAuth client for a user. */
    COOKIE_SECRET: string;
  }
}

export type {};

/**
 * `Env` itself is generated from wrangler.jsonc by `wrangler types` into
 * worker-configuration.d.ts; rerun it after changing any binding.
 *
 * Secrets are not declared in wrangler.jsonc (that file is committed), so they
 * are merged into the generated interface here. Set them with
 * `wrangler secret put <NAME>` in production and in `.dev.vars` locally.
 */
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    /** Signing key for the session cookie. */
    COOKIE_SECRET: string;

    /**
     * Injected into `env` by OAuthProvider before it calls either handler.
     * Declared here so there is a single Env type across the Worker rather
     * than an intersection that has to be threaded through every helper.
     */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

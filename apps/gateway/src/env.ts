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
     * HMAC key for the `requestState` that carries an approval between the two
     * halves of a tool call.
     *
     * Separate from COOKIE_SECRET because they protect different things for
     * different audiences: one authenticates a browser session, the other
     * authenticates a decision that travelled through an AI client and came
     * back. Sharing a key would mean a leak in either scope reaches both. At
     * least 32 bytes, or the codec refuses to start.
     */
    REQUEST_STATE_SECRET: string;

    /**
     * Injected into `env` by OAuthProvider before it calls either handler.
     * Declared here so there is a single Env type across the Worker rather
     * than an intersection that has to be threaded through every helper.
     */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

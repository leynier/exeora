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
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
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
     * Read-only R2 SQL credential for the nightly rollup and Activity.
     *
     * The archive's other coordinates (account, bucket, warehouse, table, start
     * day) are plain vars in `wrangler.jsonc` and so come from the generated
     * interface. Only this one is a secret, which is why only this one is here.
     * `AUDIT_STREAM` likewise: it is a binding, not a secret.
     *
     * Both still get a runtime check where they are read. A self-hosted
     * deployment that never provisioned Pipelines has neither, and the
     * generated types describe this repository's config rather than theirs.
     */
    AUDIT_R2_SQL_TOKEN?: string;
    /**
     * Shared secret the archive maintenance job authenticates with.
     *
     * Deliberately separate from `AUDIT_R2_SQL_TOKEN`: that one is read-only
     * and lives here so the Worker can query. The token that can delete from
     * the table never reaches the Worker at all, only the job.
     *
     * Unset means the internal routes answer 404 and nothing drains the
     * deletion queue, which is the right default for a `d1`-mode deployment.
     */
    AUDIT_MAINTENANCE_SECRET?: string;

    /**
     * Optional comma-separated emails that become administrators on first
     * sign-in. When unset, the first account to register is promoted instead
     * (self-hosted bootstrap). Not a secret: it only names who may open the
     * admin panel after they authenticate.
     */
    ADMIN_EMAILS?: string;

    /**
     * Injected into `env` by OAuthProvider before it calls either handler.
     * Declared here so there is a single Env type across the Worker rather
     * than an intersection that has to be threaded through every helper.
     */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

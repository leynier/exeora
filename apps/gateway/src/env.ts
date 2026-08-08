/**
 * `Env` itself is generated from wrangler.jsonc by `wrangler types` into
 * worker-configuration.d.ts; rerun it after changing any binding.
 *
 * Secrets are not declared in wrangler.jsonc (that file is committed), so they
 * are merged into the generated interface here. Set them with
 * `wrangler secret put <NAME>` in production and in `.dev.vars` locally.
 */

import type { Pipeline } from "cloudflare:pipelines";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AuditEvent, AuditWriteMode } from "./audit.js";

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

    /** Optional during the D1-to-Pipelines migration; `d1` remains the safe default. */
    AUDIT_WRITE_MODE?: AuditWriteMode;
    AUDIT_STREAM?: Pipeline<AuditEvent>;
    /** R2 SQL credentials used only by the nightly external rollup prototype. */
    CLOUDFLARE_ACCOUNT_ID?: string;
    AUDIT_R2_BUCKET?: string;
    AUDIT_R2_WAREHOUSE?: string;
    AUDIT_R2_SQL_TOKEN?: string;
    AUDIT_R2_TABLE?: string;
    /** First UTC day present in the Iceberg table, YYYY-MM-DD. */
    AUDIT_WAREHOUSE_START_DAY?: string;

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

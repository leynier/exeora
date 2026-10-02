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
     * deletion queue. Audit storage is required, so that is an incomplete
     * deployment rather than an alternate operating mode.
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
     * Organisation token for the Fly Sprites API, which provisions and wakes
     * Exeora Cloud machines. Unset means Cloud is off: the routes answer
     * `cloud_disabled`, the relay never tries to wake anything and the
     * reconcile job does nothing, which is how a self-hosted gateway runs
     * without it.
     */
    SPRITES_TOKEN?: string;
    /**
     * 32-byte hex key that encrypts repository access tokens at rest in
     * `cloud_projects`. Its own key rather than one of the signing secrets
     * above because rotating a cookie key must not lock every stored
     * credential. Rotating this one does, and the dashboard offers re-entry.
     */
    CLOUD_CREDENTIALS_KEY?: string;

    /**
     * The Exeora GitHub App, which is how an account connects its repositories:
     * installed once on a person or an organisation, it lets the gateway list
     * what it was given and clone with tokens that live an hour.
     *
     * A different thing from `GITHUB_CLIENT_ID` above, which is the OAuth App
     * that signs people in and knows nothing about repositories. All six are
     * needed together, and `CLOUD_CREDENTIALS_KEY` with them: what a person
     * may reach is asked of GitHub with their own token, and without the key
     * there is nowhere safe to keep it. With any of them unset the connection
     * is off: the routes answer `github_disabled` and a project clones with
     * whatever git on the machine has, which is how a gateway ran before this
     * existed.
     */
    GITHUB_APP_ID?: string;
    /** The app's name in its public address, `github.com/apps/<slug>`. */
    GITHUB_APP_SLUG?: string;
    /**
     * The app's private key as PEM. PKCS#8 is what WebCrypto reads; PKCS#1
     * (`BEGIN RSA PRIVATE KEY`) is what GitHub hands out, and is accepted too.
     */
    GITHUB_APP_PRIVATE_KEY?: string;
    /** Exchanges the code GitHub sends back after an installation for the person who made it. */
    GITHUB_APP_CLIENT_ID?: string;
    GITHUB_APP_CLIENT_SECRET?: string;
    /** HMAC key GitHub signs every webhook delivery with. */
    GITHUB_APP_WEBHOOK_SECRET?: string;

    /**
     * AI Assist: which providers an account may use, as a comma-separated list
     * of `openai`, `xai` and `chatgpt`. Unset or empty means the feature is off
     * and the routes answer `ai_disabled`. OpenAI and xAI API-key credentials
     * are kept under `CLOUD_CREDENTIALS_KEY`; a ChatGPT-only deployment does
     * not need that key because its plan credential stays on the local CLI.
     * `AI_ASSIST_OAUTH=off` removes xAI's device login while leaving API keys
     * and the machine-bound ChatGPT flow available.
     */
    AI_ASSIST_PROVIDERS?: string;
    /** `off` keeps only the API keys: no device login is offered for any provider. */
    AI_ASSIST_OAUTH?: string;
    /**
     * The OAuth client xAI knows this gateway as. Unset uses xAI's shared
     * public client for coding agents; `off` offers xAI by API key only.
     */
    XAI_OAUTH_CLIENT_ID?: string;

    /**
     * Injected into `env` by OAuthProvider before it calls either handler.
     * Declared here so there is a single Env type across the Worker rather
     * than an intersection that has to be threaded through every helper.
     */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

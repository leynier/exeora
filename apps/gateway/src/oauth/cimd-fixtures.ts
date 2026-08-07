/**
 * Client ID Metadata Documents served to the workers tests.
 *
 * A CIMD client is identified by the URL its document lives at, so testing that
 * path means answering a real outbound request. `vitest.config.ts` imports this
 * map into miniflare's `outboundService` and `cimd.workers.test.ts` authorizes
 * against the same keys, which is why it lives in a module of its own rather
 * than in either of them.
 *
 * Nothing in the Worker imports this, so it is never bundled.
 */

/** Reserved TLD, so a request that escapes the outbound service resolves nowhere. */
const ORIGIN = "https://cimd.test";

/**
 * ChatGPT's own document, field for field, with the identifiers made generic.
 *
 * The pair of auth method fields is the whole point: `private_key_jwt` is a
 * preference, and the list underneath is what there is to negotiate against.
 * `none` is in it, which is the only method a client the gateway never issued a
 * secret to can use anyway.
 */
export const NEGOTIABLE_CLIENT = `${ORIGIN}/oauth/negotiable/client.json`;

/** The same client with nothing to fall back to, which must still be refused. */
export const UNUSABLE_CLIENT = `${ORIGIN}/oauth/unusable/client.json`;

export const REDIRECT_URI = "https://cimd.test/connector/callback";

export const CIMD_DOCUMENTS: Record<string, Record<string, unknown>> = {
  [NEGOTIABLE_CLIENT]: {
    client_id: NEGOTIABLE_CLIENT,
    client_uri: ORIGIN,
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Negotiable Client",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: `${ORIGIN}/oauth/jwks.json`,
  },

  [UNUSABLE_CLIENT]: {
    client_id: UNUSABLE_CLIENT,
    client_uri: ORIGIN,
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "private_key_jwt",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Unusable Client",
    jwks_uri: `${ORIGIN}/oauth/jwks.json`,
  },
};

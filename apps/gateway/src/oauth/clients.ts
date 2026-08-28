/**
 * Exeora's own OAuth clients: the CLI and the dashboard.
 *
 * Both are *public* clients: one ships to users' machines, the other runs
 * in a browser, so neither can hold a secret and both authenticate with PKCE
 * alone.
 *
 * `createClient()` always mints its own random client id and ignores any id
 * passed in, so a fixed well-known constant is not available. Each generated
 * id is recorded in KV under a stable key and discovered at runtime.
 *
 * The standards-forward alternative is a Client ID Metadata Document, where
 * the client id is a URL the server publishes. It is deliberately not used
 * yet: CIMD resolution requires the `global_fetch_strictly_public` fetch to
 * reach that document over the public internet, which does not hold for a
 * `localhost` development server.
 */

/**
 * Executor tokens are scoped apart from MCP tokens on purpose: a token that
 * lets a machine serve tool calls must not also be usable to *make* them.
 */
export const CLI_SCOPES = ["executor:connect", "executor:execute"];

/** The dashboard only ever reads and manages; it never runs a tool. */
export const DASHBOARD_SCOPES = ["dashboard:manage"];

interface ClientSpec {
  kvKey: string;
  clientName: string;
  redirectUris: string[];
}

/** Loopback callback `exeora login` binds on a desktop. Port is free (RFC 8252). */
export const CLI_LOOPBACK_REDIRECT = "http://127.0.0.1/callback";

/** Redirect used only to mint a code during `exeora login --code`; never opened. */
export function cliDeviceRedirectUri(env: Pick<Env, "EXEORA_BASE_URL">): string {
  return new URL("/oauth/device/callback", env.EXEORA_BASE_URL).toString();
}

function cliRedirectUris(env: Pick<Env, "EXEORA_BASE_URL">): string[] {
  return [CLI_LOOPBACK_REDIRECT, cliDeviceRedirectUri(env)];
}

const CLI_KV_KEY = "cli_client_id";

function cliSpec(env: Pick<Env, "EXEORA_BASE_URL">): ClientSpec {
  return {
    kvKey: CLI_KV_KEY,
    clientName: "Exeora CLI",
    redirectUris: cliRedirectUris(env),
  };
}

const DASHBOARD_KV_KEY = "dashboard_client_id";

function dashboard(env: Env): ClientSpec {
  return {
    kvKey: DASHBOARD_KV_KEY,
    clientName: "Exeora Dashboard",
    redirectUris: [new URL("/dashboard/callback", env.EXEORA_BASE_URL).toString()],
  };
}

export const getCliClientId = (env: Env) => clientIdFor(env, cliSpec(env));
export const getDashboardClientId = (env: Env) => clientIdFor(env, dashboard(env));

/**
 * Whether this client is the dashboard, which is Exeora's own first-party UI.
 *
 * Read straight from KV rather than through `getDashboardClientId`, because
 * that one registers the client when it is missing and an authorize request
 * naming some other client should not have that side effect.
 */
export async function isDashboardClient(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
): Promise<boolean> {
  const stored = await env.OAUTH_KV.get(DASHBOARD_KV_KEY);
  return stored !== null && stored === clientId;
}

/** Whether this is the public client installed by the native executor. */
export async function isCliClient(env: Pick<Env, "OAUTH_KV">, clientId: string): Promise<boolean> {
  const stored = await env.OAUTH_KV.get(CLI_KV_KEY);
  return stored !== null && stored === clientId;
}

/**
 * Returns the client's id, registering it on first use. Idempotent, so a fresh
 * deployment heals itself the first time anyone signs in.
 */
async function clientIdFor(env: Env, spec: ClientSpec): Promise<string> {
  const stored = await env.OAUTH_KV.get(spec.kvKey);
  // Re-checked against the provider: a client can be deleted while the KV
  // pointer survives.
  if (stored) {
    const existing = await env.OAUTH_PROVIDER.lookupClient(stored);
    if (existing) {
      // A deployed CLI client may predate the device-code redirect. Adding it
      // here is how an existing deployment heals itself the next time anyone
      // signs in, without minting a second client id.
      const registered = existing.redirectUris ?? [];
      const missing = spec.redirectUris.filter((uri) => !registered.includes(uri));
      if (missing.length > 0) {
        await env.OAUTH_PROVIDER.updateClient(stored, {
          redirectUris: [...registered, ...missing],
        });
      }
      return stored;
    }
  }

  const client = await env.OAUTH_PROVIDER.createClient({
    clientName: spec.clientName,
    redirectUris: spec.redirectUris,
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
  });

  await env.OAUTH_KV.put(spec.kvKey, client.clientId);
  return client.clientId;
}

/**
 * Exeora's own OAuth clients: the CLI, the dashboard and the Chrome extension.
 *
 * All are *public* clients: one ships to users' machines, the others run in a
 * browser, so none can hold a secret and all authenticate with PKCE alone.
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
  /**
   * Whether the registered redirects are replaced by these rather than only
   * added to. The extension's follow a configured list of ids, and an id taken
   * off that list must stop receiving codes, not linger as a registered
   * redirect nobody can see.
   */
  exact?: boolean;
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

const EXTENSION_KV_KEY = "extension_client_id";

/**
 * The Chrome extension ids allowed to sign in, from `EXEORA_EXTENSION_IDS`.
 *
 * An id is what Chrome derives from the extension's key, and it is the only
 * thing that decides who receives a code sent to its `chromiumapp.org`
 * redirect: Chrome hands that navigation to the extension with that id and to
 * nothing else. So naming the ids here is what makes the extension a
 * first-party client, the way the dashboard's own origin makes it one.
 */
export function extensionIds(env: Pick<Env, "EXEORA_EXTENSION_IDS">): string[] {
  return (env.EXEORA_EXTENSION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[a-p]{32}$/.test(id));
}

/** The origins the extension's pages load from, one per allowed id. */
export function extensionOrigins(env: Pick<Env, "EXEORA_EXTENSION_IDS">): string[] {
  return extensionIds(env).map((id) => `chrome-extension://${id}`);
}

/**
 * The origin one of Exeora's own browser UIs runs on, or null for any other.
 *
 * The dashboard is served from the gateway's origin and the side panel from
 * an allowed extension's. A terminal ticket is bound to the one that asked for
 * it, and its socket is refused from anywhere else.
 */
export function firstPartyOrigin(
  env: Pick<Env, "EXEORA_BASE_URL" | "EXEORA_EXTENSION_IDS">,
  origin: string | undefined,
): string | null {
  if (!origin) return null;
  if (origin === new URL(env.EXEORA_BASE_URL).origin) return origin;
  return extensionOrigins(env).includes(origin) ? origin : null;
}

function extension(env: Env): ClientSpec {
  return {
    kvKey: EXTENSION_KV_KEY,
    clientName: "Exeora for Chrome",
    redirectUris: extensionIds(env).map((id) => `https://${id}.chromiumapp.org/`),
    exact: true,
  };
}

export const getCliClientId = (env: Env) => clientIdFor(env, cliSpec(env));
export const getDashboardClientId = (env: Env) => clientIdFor(env, dashboard(env));

/** Null when this gateway names no extension, which leaves it switched off. */
export async function getExtensionClientId(env: Env): Promise<string | null> {
  if (extensionIds(env).length === 0) return null;
  return clientIdFor(env, extension(env));
}

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

/** Whether this client is the Chrome extension, read the same way as the dashboard's. */
export async function isExtensionClient(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
): Promise<boolean> {
  const stored = await env.OAUTH_KV.get(EXTENSION_KV_KEY);
  return stored !== null && stored === clientId;
}

/**
 * Exeora's own browser UIs: the dashboard and the extension's side panel. Both
 * manage the account, because a code sent to either redirect can only land in
 * Exeora's own code. Whether one is asked for consent is `skipsConsent`'s call.
 */
export async function isFirstPartyUiClient(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
): Promise<boolean> {
  return (await isDashboardClient(env, clientId)) || (await isExtensionClient(env, clientId));
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
      const stale = spec.exact ? registered.filter((uri) => !spec.redirectUris.includes(uri)) : [];
      if (missing.length > 0 || stale.length > 0) {
        await env.OAUTH_PROVIDER.updateClient(stored, {
          redirectUris: spec.exact ? spec.redirectUris : [...registered, ...missing],
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

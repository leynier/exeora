import "../env.js";

/**
 * The Exeora GitHub App, as far as the gateway speaks for it.
 *
 * An app proves who it is with a JWT signed by its private key, good for ten
 * minutes, and trades it for an installation token: an hour of access to the
 * repositories one account gave it, narrowed further to the repositories and
 * permissions the request names. Nothing longer lived than that ever leaves
 * the gateway, and the key itself never leaves this file.
 *
 * Every function takes the fetcher last, the way `sprites.ts` does: the
 * workers tests refuse outbound requests, so a test hands in a fake.
 */

export const GITHUB_API = "https://api.github.com";

/**
 * The secrets the connection needs, all of them or none: the six of the app,
 * and the key that encrypts the token of each person who connects.
 */
export type GitHubEnv = Pick<
  Env,
  | "GITHUB_APP_ID"
  | "GITHUB_APP_SLUG"
  | "GITHUB_APP_PRIVATE_KEY"
  | "GITHUB_APP_CLIENT_ID"
  | "GITHUB_APP_CLIENT_SECRET"
  | "GITHUB_APP_WEBHOOK_SECRET"
  | "CLOUD_CREDENTIALS_KEY"
>;

export interface GitHubConfig {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  /** `CLOUD_CREDENTIALS_KEY`, under which the tokens of people are kept. */
  credentialsKey: string;
}

export type GitHubPermissions = Partial<
  Record<"contents" | "metadata" | "pull_requests", "read" | "write">
>;

export interface InstallationToken {
  token: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export class GitHubError extends Error {
  /**
   * `status` is what GitHub answered, or 0 when it could not be reached.
   * `message` is a sentence that can be shown to the person as it is: it
   * never quotes a response body, which may echo what was sent.
   */
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * The account's authorization on GitHub is gone: revoked there, expired with
 * nothing to renew it, or never stored. Nothing is reached through GitHub
 * until the person connects again, which the routes answer as 409.
 */
export class GitHubReconnectError extends GitHubError {
  constructor() {
    super(
      409,
      "GitHub no longer accepts this account's authorization. Connect GitHub again from the settings.",
    );
    this.name = "GitHubReconnectError";
  }
}

/** The configuration, or null on a gateway where the connection is off. */
export function githubConfig(env: GitHubEnv): GitHubConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  // Without the key there is nowhere safe to keep a person's token, and
  // without their token nothing says what they may reach.
  const credentialsKey = env.CLOUD_CREDENTIALS_KEY?.trim();
  if (!appId || !slug || !privateKey || !clientId || !clientSecret || !webhookSecret) return null;
  if (!credentialsKey) return null;
  return { appId, slug, privateKey, clientId, clientSecret, webhookSecret, credentialsKey };
}

/** What every request to GitHub carries, whoever it is made as. */
export function githubHeaders(authorization?: string): Record<string, string> {
  return {
    "User-Agent": "exeora-gateway",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

/**
 * The app's own credential. Dated a minute back because GitHub refuses a
 * token issued in its future, and a clock a few seconds ahead is ordinary;
 * nine minutes forward because ten is the most it accepts.
 */
export async function appJwt(
  config: Pick<GitHubConfig, "appId" | "privateKey">,
  now: number = Date.now(),
): Promise<string> {
  const seconds = Math.floor(now / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const claims = encodeJson({ iat: seconds - 60, exp: seconds + 9 * 60, iss: config.appId });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(config.privateKey),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

/** Tokens still good, by what they were asked for. Lost with the isolate, which costs one request. */
const tokens = new Map<string, InstallationToken>();
/** A token is handed out only while it has this long left, so a clone that starts now can finish. */
const REUSE_MARGIN_MS = 5 * 60_000;

/** For the tests, which share one isolate and must not share its tokens. */
export function forgetInstallationTokens(): void {
  tokens.clear();
}

/**
 * A token for one installation, narrowed to the repositories and permissions
 * named. Left unnamed, each is everything the installation was given.
 */
export async function installationToken(
  config: GitHubConfig,
  installationId: number,
  scope: { repositoryIds?: number[] | undefined; permissions?: GitHubPermissions | undefined },
  fetcher: typeof fetch,
  now: number = Date.now(),
): Promise<InstallationToken> {
  // The permissions are part of the key: a token that may only read names
  // must never be the answer to a request for one that may push.
  const key = [
    config.appId,
    installationId,
    [...(scope.repositoryIds ?? [])].sort((a, b) => a - b).join(","),
    Object.entries(scope.permissions ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, level]) => `${name}:${level}`)
      .join(","),
  ].join("|");
  const held = tokens.get(key);
  if (held && held.expiresAt - now > REUSE_MARGIN_MS) return held;
  tokens.delete(key);

  const response = await githubFetch(
    fetcher,
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(`Bearer ${await appJwt(config, now)}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(scope.repositoryIds?.length ? { repository_ids: scope.repositoryIds } : {}),
        ...(scope.permissions ? { permissions: scope.permissions } : {}),
      }),
    },
  );
  await expectOk(response);
  const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
  const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
  if (typeof body.token !== "string" || body.token === "" || Number.isNaN(expiresAt)) {
    throw new GitHubError(502, "GitHub answered with something that is not a token. Try again.");
  }
  const minted = { token: body.token, expiresAt };
  tokens.set(key, minted);
  return minted;
}

/** A request that never throws anything but a `GitHubError`. */
export async function githubFetch(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GitHubError(0, "GitHub could not be reached. Try again in a few minutes.");
  }
}

/** Refuses anything but a success, in words about the cause rather than the response. */
export async function expectOk(response: Response): Promise<void> {
  if (response.ok) return;
  // Read and dropped: the body is released, and nothing in it is repeated.
  await response.text().catch(() => "");
  throw new GitHubError(response.status, sentenceFor(response.status));
}

function sentenceFor(status: number): string {
  if (status === 401) {
    return "GitHub refused the credentials of this gateway's app. Whoever runs the gateway has to check the app id and its private key.";
  }
  if (status === 403) {
    return "GitHub refused access. The app may be suspended on that account, or the request limit was reached: check the installation on GitHub, then try again.";
  }
  if (status === 404) {
    return "GitHub no longer has that installation or repository. Connect GitHub again from the settings.";
  }
  if (status === 422) {
    return "GitHub could not grant that access: the repository is not part of the installation, or the app lacks a permission. Review what the app may reach on GitHub.";
  }
  return "GitHub could not answer. Try again in a few minutes.";
}

/** Keys already parsed, by their PEM: importing one is the slow part of signing. */
const keys = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keys.get(pem);
  if (!key) {
    key = importSigningKey(pem);
    keys.set(pem, key);
    // A key that could not be read is not remembered as one.
    key.catch(() => keys.delete(pem));
  }
  return key;
}

async function importSigningKey(pem: string): Promise<CryptoKey> {
  // A secret pasted on one line keeps its line breaks as the two characters.
  const text = pem.replaceAll("\\n", "\n");
  const match = /-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/.exec(text);
  if (!match?.[1] || !match[2]) {
    throw new GitHubError(
      500,
      "This gateway's GitHub App key is not a PEM private key. Whoever runs the gateway has to set GITHUB_APP_PRIVATE_KEY again.",
    );
  }
  let der: Uint8Array;
  try {
    der = decodeBase64(match[2].replace(/\s+/g, ""));
    // GitHub downloads the key as PKCS#1, and WebCrypto reads only PKCS#8.
    if (match[1] === "RSA PRIVATE KEY") der = pkcs8FromPkcs1(der);
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new GitHubError(
      500,
      "This gateway's GitHub App key could not be read. Whoever runs the gateway has to set GITHUB_APP_PRIVATE_KEY again.",
    );
  }
}

/**
 * Wraps an RSA key in the envelope PKCS#8 puts around every key: a version,
 * the algorithm (rsaEncryption, with its mandatory NULL), and the PKCS#1
 * bytes as they are inside an octet string.
 */
export function pkcs8FromPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algorithm, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/** One byte below 128, otherwise the count of length bytes and then the length. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeBase64(text: string): Uint8Array {
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

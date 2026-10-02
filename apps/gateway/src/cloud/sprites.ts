import "../env.js";

/**
 * The Fly Sprites API, as far as Exeora Cloud uses it.
 *
 * Every function takes the fetcher last, the way `r2-sql.ts` does: the workers
 * tests refuse outbound requests, so a test hands in a fake and the code under
 * test never knows. Errors carry the HTTP status so a caller can tell a
 * rejected token (stop, tell the person) from a flaky 502 (try again later).
 */

export const SPRITES_API = "https://api.sprites.dev";

export interface SpritesConfig {
  /** Organisation token, `org/id/secret`. */
  token: string;
  apiBase?: string;
}

export interface Sprite {
  id: string;
  name: string;
  url: string;
  status: "cold" | "warm" | "running";
}

export interface SpriteServiceSpec {
  cmd: string;
  args: string[];
  needs: string[];
  env: Record<string, string>;
  dir?: string;
  http_port?: number;
}

export class SpritesError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "SpritesError";
  }

  /** Worth another attempt later: the request was fine, the service was not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Keep a noisy command from turning one Worker invocation into a memory sink. */
export const MAX_EXEC_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Idempotent: a name already taken is the same Sprite, looked up instead. */
export async function createSprite(
  config: SpritesConfig,
  name: string,
  fetcher: typeof fetch,
): Promise<Sprite> {
  const response = await request(config, fetcher, "POST", "/v1/sprites", {
    body: JSON.stringify({ name, url_settings: { auth: "sprite" } }),
    headers: { "content-type": "application/json" },
  });
  if (response.status === 409) {
    await response.body?.cancel().catch(() => undefined);
    const existing = await getSprite(config, name, fetcher);
    if (existing) return existing;
  }
  await expectOk(response, "create the machine");
  return readSprite(await response.json().catch(() => null), "create the machine");
}

export async function getSprite(
  config: SpritesConfig,
  name: string,
  fetcher: typeof fetch,
): Promise<Sprite | null> {
  const response = await request(config, fetcher, "GET", `/v1/sprites/${encodeURIComponent(name)}`);
  if (response.status === 404) return null;
  await expectOk(response, "read the machine");
  return readSprite(await response.json().catch(() => null), "read the machine");
}

/** Idempotent: a machine that is already gone is a success. */
export async function deleteSprite(
  config: SpritesConfig,
  name: string,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await request(
    config,
    fetcher,
    "DELETE",
    `/v1/sprites/${encodeURIComponent(name)}`,
  );
  if (response.status === 404) return;
  await expectOk(response, "delete the machine");
}

/**
 * Every machine of the organisation, or those under a name prefix. The API
 * pages at fifty by default and says so with `has_more`; a sweep that read
 * one page would never see the orphans past it.
 */
export async function listSprites(
  config: SpritesConfig,
  fetcher: typeof fetch,
  options: { prefix?: string } = {},
): Promise<Sprite[]> {
  const sprites: Sprite[] = [];
  let token: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ max_results: "500" });
    if (options.prefix) query.set("prefix", options.prefix);
    if (token) query.set("continuation_token", token);
    const response = await request(config, fetcher, "GET", `/v1/sprites?${query}`);
    await expectOk(response, "list the machines");
    const body = (await response.json()) as
      | Sprite[]
      | {
          sprites?: Sprite[];
          data?: Sprite[];
          has_more?: boolean;
          next_continuation_token?: string;
        };
    if (Array.isArray(body)) return body;
    sprites.push(...(body.sprites ?? body.data ?? []));
    if (!body.has_more || !body.next_continuation_token) break;
    token = body.next_continuation_token;
  }
  return sprites;
}

/** Marks where the exit status of an exec'd script lands in its output. */
const EXIT_MARK = /__EXEORA_EXIT_(\d+)__\s*$/;

/**
 * Runs a bash script inside the machine and waits for it.
 *
 * The exec endpoint answers with raw output and no status, so the script is
 * run in a subshell and its status printed after it: `set -e` inside the
 * script ends the subshell, never the shell that prints the mark. No mark at
 * all means the script never finished, and the caller treats that as failure.
 */
export async function execSprite(
  config: SpritesConfig,
  name: string,
  options: { script: string; timeoutMs: number },
  fetcher: typeof fetch,
): Promise<{ output: string; exitCode: number | null }> {
  const response = await request(
    config,
    fetcher,
    "POST",
    `/v1/sprites/${encodeURIComponent(name)}/exec?cmd=bash&cmd=-s&stdin=true`,
    {
      body: `(\n${options.script}\n)\nrc=$?\nprintf '\\n__EXEORA_EXIT_%s__\\n' "$rc"\n`,
      headers: { "content-type": "application/octet-stream" },
      timeoutMs: options.timeoutMs,
    },
  );
  await expectOk(response, "run a command on the machine");
  const raw = unframeExecOutput(await readLimitedBody(response));
  const mark = EXIT_MARK.exec(raw);
  return {
    output: mark ? raw.slice(0, mark.index) : raw,
    exitCode: mark ? Number(mark[1]) : null,
  };
}

/** Stream tags the exec endpoint writes before each chunk, and after the last. */
const STDOUT_FRAME = 0x01;
const STDERR_FRAME = 0x02;
const EXIT_FRAME = 0x03;

/**
 * The exec endpoint's body is not the bare output: every chunk is preceded
 * by a byte naming its stream (1 stdout, 2 stderr), and the body ends with a
 * 3 and the process's exit code as one byte. Those bytes are dropped here so
 * what is left is the output as the script wrote it; the exit status the
 * callers trust is still the one the script prints, since the process that
 * exits is the wrapper around it. A body without the tags passes through.
 * Neither tag can occur inside UTF-8 text, so dropping them is safe.
 */
export function unframeExecOutput(bytes: Uint8Array): string {
  let end = bytes.length;
  if (end >= 2 && bytes[end - 2] === EXIT_FRAME) end -= 2;
  const kept = bytes
    .subarray(0, end)
    .filter((byte) => byte !== STDOUT_FRAME && byte !== STDERR_FRAME);
  return new TextDecoder().decode(kept);
}

/** Creates or replaces the named service; the runtime starts it at once. */
export async function putService(
  config: SpritesConfig,
  name: string,
  service: string,
  spec: SpriteServiceSpec,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await request(
    config,
    fetcher,
    "PUT",
    `/v1/sprites/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}`,
    { body: JSON.stringify(spec), headers: { "content-type": "application/json" } },
  );
  await expectOk(response, "start the service on the machine");
}

/** The tail of a service's log, for an error message when it never connected. */
export async function readServiceLog(
  config: SpritesConfig,
  name: string,
  service: string,
  fetcher: typeof fetch,
): Promise<string> {
  try {
    const { output } = await execSprite(
      config,
      name,
      {
        script: `tail -c 4000 /.sprite/logs/services/${service}.log 2>/dev/null || true`,
        timeoutMs: 15_000,
      },
      fetcher,
    );
    return output.trim();
  } catch {
    return "";
  }
}

async function request(
  config: SpritesConfig,
  fetcher: typeof fetch,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  const base = spriteEndpoint(config.apiBase ?? SPRITES_API);
  if (!base) {
    throw new SpritesError(500, "", "The Sprites API configuration is invalid.");
  }
  try {
    return await fetcher(`${base}${path}`, {
      method,
      // Callers may add content headers, but the provider credential always
      // wins if a caller accidentally supplies Authorization too.
      headers: { ...options.headers, authorization: `Bearer ${config.token}` },
      ...(options.body !== undefined ? { body: options.body } : {}),
      // The organisation token is valid only for Sprites. Do not replay it at
      // a host named by a redirect response.
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch {
    throw new SpritesError(0, "", "Could not reach the Sprites API. Try again in a few minutes.");
  }
}

async function expectOk(response: Response, doing: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.text().catch(() => "")).slice(0, 500);
  const why =
    response.status === 401 || response.status === 403
      ? "the Sprites token was rejected"
      : `the Sprites API answered ${response.status}`;
  throw new SpritesError(response.status, body, `Could not ${doing}: ${why}.`);
}

function readSprite(value: unknown, doing: string): Sprite {
  const url = isRecord(value) ? spriteEndpoint(value.url) : null;
  if (!isRecord(value) || !url) {
    throw new SpritesError(502, "", `Could not ${doing}: Sprites returned an invalid machine.`);
  }
  return { ...(value as unknown as Sprite), url };
}

/** Only HTTPS, authority-only URLs may receive the organisation bearer. */
export function spriteEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value;
      total += chunk.byteLength;
      if (total > MAX_EXEC_OUTPUT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SpritesError(
          502,
          "",
          "Could not run a command on the machine: its output was too large.",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

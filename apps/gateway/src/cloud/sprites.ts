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
    const existing = await getSprite(config, name, fetcher);
    if (existing) return existing;
  }
  await expectOk(response, "create the machine");
  return (await response.json()) as Sprite;
}

export async function getSprite(
  config: SpritesConfig,
  name: string,
  fetcher: typeof fetch,
): Promise<Sprite | null> {
  const response = await request(config, fetcher, "GET", `/v1/sprites/${encodeURIComponent(name)}`);
  if (response.status === 404) return null;
  await expectOk(response, "read the machine");
  return (await response.json()) as Sprite;
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
  const raw = await response.text();
  const mark = EXIT_MARK.exec(raw);
  return {
    output: mark ? raw.slice(0, mark.index) : raw,
    exitCode: mark ? Number(mark[1]) : null,
  };
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
  const base = (config.apiBase ?? SPRITES_API).replace(/\/$/, "");
  try {
    return await fetcher(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.token}`, ...options.headers },
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new SpritesError(
      0,
      "",
      `Could not reach the Sprites API: ${error instanceof Error ? error.message : String(error)}`,
    );
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

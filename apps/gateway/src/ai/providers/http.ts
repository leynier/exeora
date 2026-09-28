import { AiError } from "./types.js";

/**
 * What every provider request has in common: a deadline, a fetch that never
 * throws anything but an `AiError`, and the shapes the Responses API answers
 * in. The wording never repeats a response body: the request it answered
 * carried the person's diff.
 */

/** How long a request that is not a generation may take. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** How long a generation may take, whatever the request's own signal says. */
export const GENERATE_TIMEOUT_MS = 60_000;

/** A signal that fires when either fires: the caller's, or the deadline. */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    ms,
  );
  const settle = () => clearTimeout(timer);
  controller.signal.addEventListener("abort", settle, { once: true });
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * A request that never throws anything but an `AiError`, and never follows
 * a redirect: a 307 or 308 would send the body, which may carry a token, a
 * device code or an API key, wherever `Location` points. No provider
 * redirects the endpoints asked here, so a redirect is a failure.
 */
export async function providerFetch(
  fetcher: typeof fetch,
  label: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...rest,
      redirect: "manual",
      signal: withTimeout(timeoutMs ?? REQUEST_TIMEOUT_MS, signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AiError("unavailable", `${label} could not be reached. Try again in a few minutes.`);
  }
  if (response.status >= 300 && response.status < 400 && response.headers.has("Location")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiError(
      "unavailable",
      `${label} redirected the request, which is not followed. Try again in a few minutes.`,
    );
  }
  return response;
}

/** Refuses anything but a success, in words about the cause rather than the response. */
export async function expectOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  await response.text().catch(() => "");
  throw new AiError(
    response.status === 401 || response.status === 403 ? "reconnect" : "unavailable",
    sentenceFor(response.status, label),
  );
}

function sentenceFor(status: number, label: string): string {
  if (status === 401 || status === 403) {
    return `${label} no longer accepts this account's credential. Link it again from the settings.`;
  }
  if (status === 429) return `${label} is rate limiting this account. Try again in a minute.`;
  return `${label} could not answer. Try again in a few minutes.`;
}

/** The body as JSON, or an `AiError` when it is not. */
export async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AiError(
      "unavailable",
      `${label} answered with something that is not JSON. Try again.`,
    );
  }
}

export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** What a Responses-style body holds beside the text. */
export function outputText(body: unknown): string {
  if (body === null || typeof body !== "object") return "";
  const raw = body as { output_text?: unknown; output?: unknown };
  if (typeof raw.output_text === "string" && raw.output_text !== "") return raw.output_text;
  return outputItemsText(raw.output);
}

/** The text of the `output` items of a Responses body, in order. */
export function outputItemsText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (item === null || typeof item !== "object") continue;
    const { type, content } = item as { type?: unknown; content?: unknown };
    if (type !== "message" || !Array.isArray(content)) continue;
    for (const part of content) {
      if (part === null || typeof part !== "object") continue;
      const { type: partType, text } = part as { type?: unknown; text?: unknown };
      if (partType === "output_text" && typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}

/** The text of a chat completion, for an endpoint that only speaks that. */
export function chatCompletionText(body: unknown): string {
  if (body === null || typeof body !== "object") return "";
  const { choices } = body as { choices?: unknown };
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

/** The Responses API request for one system and one user message. */
export function responsesInput(system: string, user: string) {
  return {
    instructions: system,
    input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
  };
}

/** Model ids out of a `{ data: [{ id }] }` or `{ models: [{ slug | id, display_name? }] }` listing. */
export function listedModels(body: unknown): Array<{ id: string; label?: string | undefined }> {
  if (body === null || typeof body !== "object") return [];
  const { data, models } = body as { data?: unknown; models?: unknown };
  const items = Array.isArray(data) ? data : Array.isArray(models) ? models : [];
  const found: Array<{ id: string; label?: string | undefined }> = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const raw = item as { id?: unknown; slug?: unknown; display_name?: unknown; name?: unknown };
    const id = typeof raw.slug === "string" ? raw.slug : typeof raw.id === "string" ? raw.id : "";
    if (id === "") continue;
    const label =
      typeof raw.display_name === "string"
        ? raw.display_name
        : typeof raw.name === "string"
          ? raw.name
          : undefined;
    found.push({ id, label });
  }
  return found;
}

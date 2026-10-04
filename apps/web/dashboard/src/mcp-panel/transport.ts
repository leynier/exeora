/**
 * The dashboard API, carried as tool calls.
 *
 * In ChatGPT the panel is untrusted script in the host's sandbox, so it never
 * holds an Exeora token. Each request the Workspace makes goes to the host as
 * a call to the app-only `exeora_panel_request` tool, the host forwards it on
 * the connection the user already authorized, and the gateway answers it from
 * an allowlist of Workspace routes as that user. What comes back is shaped
 * into a `Response`, so `request()` keeps its own handling of a refusal.
 *
 * `origin` is the sandbox the panel runs in. The gateway binds the one-use
 * terminal and log tickets to it, the origin their WebSocket will come from.
 */

export const PANEL_REQUEST_TOOL = "exeora_panel_request";

/** The parts of an MCP `CallToolResult` the panel reads. */
export interface ToolAnswer {
  isError?: boolean;
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
}

export type CallTool = (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ToolAnswer>;

const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** Statuses a `Response` cannot carry a body with; `request()` reads one anyway. */
const NULL_BODY = new Set([101, 204, 205, 304]);

export function toolTransport(call: CallTool, origin?: string) {
  return async (path: string, init: RequestInit): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    if (!METHODS.has(method)) throw new Error(`Unsupported method ${method}.`);
    const args: Record<string, unknown> = { method, path };
    if (origin) args.origin = origin;
    const body = readBody(init.body);
    if (body !== undefined) args.body = body;

    const answer = await call(PANEL_REQUEST_TOOL, args, init.signal ?? undefined);
    if (answer.isError) throw new Error(answerText(answer) || "The request did not reach Exeora.");

    const result = answer.structuredContent as { status?: unknown; body?: unknown } | undefined;
    const status = result?.status;
    if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
      throw new Error("Exeora answered the request with something unreadable.");
    }
    return new Response(JSON.stringify(result?.body ?? null), {
      status: NULL_BODY.has(status) ? 200 : status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** The Workspace only sends JSON, as a string. */
function readBody(body: RequestInit["body"]): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") throw new Error("Only JSON request bodies can be sent.");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Only JSON request bodies can be sent.");
  }
}

/** The text a tool put in its content, which is where an error explains itself. */
export function answerText(answer: ToolAnswer): string {
  return (answer.content ?? [])
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

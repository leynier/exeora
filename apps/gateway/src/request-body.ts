/** Bounds bytes actually consumed, including chunked or understated bodies. */
export const MAX_AUTH_BODY_BYTES = 64 * 1024;
export const MAX_API_BODY_BYTES = 16 * 1024 * 1024;
// GitHub delivers payloads up to 25 MB; retain room for that documented cap.
export const MAX_WEBHOOK_BODY_BYTES = 25 * 1024 * 1024;

export function requestBodyLimit(pathname: string): number | undefined {
  if (pathname === "/api/github/webhook") return MAX_WEBHOOK_BODY_BYTES;
  if (pathname.startsWith("/oauth/")) return MAX_AUTH_BODY_BYTES;
  if (pathname.startsWith("/api/") || pathname.startsWith("/p/") || pathname === "/mcp") {
    return MAX_API_BODY_BYTES;
  }
  return undefined;
}

export function bodyTooLarge(): Response {
  return Response.json(
    { error: "request_too_large" },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Keep the request streaming: authentication may refuse it without reading it.
 * A shared flag also survives Request.clone(), and lets the outer handler turn
 * a parser's caught stream error into 413 instead of a misleading 400 or 500.
 */
export function limitRequestBody(
  request: Request,
  limit: number,
): { request: Request; exceeded: () => boolean } {
  let exceeded = false;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    return { request, exceeded: () => true };
  }
  if (!request.body) return { request, exceeded: () => false };

  const reader = request.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            reader.releaseLock();
            return;
          }
          bytes += chunk.value.byteLength;
          if (bytes > limit) {
            exceeded = true;
            controller.error(new Error("Request body exceeds the byte limit."));
            // Cancellation of a tee can wait for its other branch. Never wait
            // for it before returning the rejection to the caller.
            void reader.cancel().catch(() => undefined);
            return;
          }
          controller.enqueue(chunk.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return { request: new Request(request, { body }), exceeded: () => exceeded };
}

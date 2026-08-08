/**
 * Low-volume structured cost telemetry.
 *
 * Cloudflare already exposes the authoritative account totals. These samples
 * add the application dimensions needed to explain them without emitting one
 * paid analytics point (or one log line) per tool call. Every sampled row
 * carries its weight so sums can be estimated with `value * sampleWeight`.
 */

const SAMPLE_DENOMINATOR = 1_024;

interface D1Meta {
  rows_read?: number | undefined;
  rows_written?: number | undefined;
  duration?: number | undefined;
  changes?: number | undefined;
}

/**
 * A `null` sample key emits every time.
 *
 * For an operation that already runs a handful of times a day, sampling costs
 * nothing and loses everything: the key would have to vary per call to draw
 * independently, and a rare operation has no such key to offer.
 */
export function observeD1(
  sampleKey: string | null,
  operation: "audit.insert" | "client.touch" | "presence.touch" | "usage.upsert",
  meta: D1Meta,
): void {
  if (sampleKey !== null && !sampled(sampleKey)) return;

  emit({
    metric: "d1.operation",
    operation,
    rowsRead: meta.rows_read ?? 0,
    rowsWritten: meta.rows_written ?? 0,
    changes: meta.changes ?? 0,
    queryDurationMs: meta.duration ?? 0,
    sampleWeight: sampleKey === null ? 1 : SAMPLE_DENOMINATOR,
  });
}

export function observeTool(
  requestId: string,
  durationMs: number,
  concurrentCalls: number,
  status: "ok" | "error",
): void {
  if (!sampled(requestId)) return;

  emit({
    metric: "relay.tool",
    durationMs,
    concurrentCalls,
    status,
    executorMessages: 2,
    callerMessages: 2,
    sampleWeight: SAMPLE_DENOMINATOR,
  });
}

export function observeRelayTermination(
  requestId: string,
  durationMs: number,
  status: "cancelled" | "timeout" | "offline",
  messages: { caller: number; executor: number },
): void {
  if (!sampled(requestId)) return;
  emit({
    metric: "relay.termination",
    durationMs,
    status,
    callerMessages: messages.caller,
    executorMessages: messages.executor,
    sampleWeight: SAMPLE_DENOMINATOR,
  });
}

export function observePipeline(eventId: string, status: "accepted" | "failed"): void {
  if (!sampled(eventId)) return;
  emit({
    metric: "pipeline.event",
    status,
    sampleWeight: SAMPLE_DENOMINATOR,
  });
}

function sampled(key: string): boolean {
  // FNV-1a is stable across isolates and cheap enough for the request path.
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SAMPLE_DENOMINATOR === 0;
}

function emit(fields: Record<string, string | number>): void {
  console.info(JSON.stringify({ source: "exeora.cost", ...fields }));
}

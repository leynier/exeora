/**
 * Server-sent events, as a streaming Responses endpoint sends them: blocks
 * of `event:` and `data:` lines separated by a blank line. Only what the
 * generation needs is read; ids and retry hints are dropped.
 */

export interface SseEvent {
  event: string | undefined;
  data: string;
}

/** Feeds chunks in as they arrive and hands back the events they complete. */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let boundary = blankLine(this.buffer);
    while (boundary !== null) {
      const block = this.buffer.slice(0, boundary.at);
      this.buffer = this.buffer.slice(boundary.at + boundary.length);
      const event = parseBlock(block);
      if (event) events.push(event);
      boundary = blankLine(this.buffer);
    }
    return events;
  }

  /** The event the stream ended in the middle of, if it holds any data. */
  flush(): SseEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    const event = parseBlock(rest);
    return event ? [event] : [];
  }
}

/** Every event in a whole body. */
export function parseSse(text: string): SseEvent[] {
  const parser = new SseParser();
  return [...parser.push(text), ...parser.flush()];
}

/** The events of a response body as they arrive. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event;
    }
    for (const event of parser.push(decoder.decode())) yield event;
    for (const event of parser.flush()) yield event;
  } finally {
    reader.releaseLock();
  }
}

function blankLine(text: string): { at: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(text);
  return match ? { at: match.index, length: match[0].length } : null;
}

function parseBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

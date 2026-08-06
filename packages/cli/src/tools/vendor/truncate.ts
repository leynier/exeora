/**
 * Head truncation for `read_file`.
 *
 * Adapted from pi-coding-agent's `src/core/tools/truncate.ts` (MIT, Copyright
 * (c) 2025 Mario Zechner); see the third-party notice in this package's
 * LICENSE. Only head truncation is kept: `run_command` and `grep` cap their own
 * output against the protocol's limits, and tail truncation is a shell-output
 * concern this executor does not have.
 *
 * Two independent limits, whichever is hit first wins, and a line is never cut
 * in half: an agent that receives half a line of JSON has been handed a lie.
 */

export interface TruncationOptions {
  maxLines: number;
  maxBytes: number;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  /** Which limit was hit, or null when nothing was cut. */
  truncatedBy: "lines" | "bytes" | null;
  /** Lines in the input, not in the output. */
  totalLines: number;
  /** Complete lines in the output. */
  outputLines: number;
  /**
   * True when the first line alone is over the byte limit, in which case the
   * content is empty: there is no honest prefix to return.
   */
  firstLineExceedsLimit: boolean;
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  // A trailing newline terminates the last line, it does not start a new one.
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

/** Keep the first lines that fit within both limits. */
export function truncateHead(content: string, options: TruncationOptions): TruncationResult {
  const { maxLines, maxBytes } = options;

  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      outputLines: totalLines,
      firstLineExceedsLimit: false,
    };
  }

  const firstLine = lines[0] ?? "";
  if (Buffer.byteLength(firstLine, "utf8") > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      outputLines: 0,
      firstLineExceedsLimit: true,
    };
  }

  const kept: string[] = [];
  let keptBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (const [index, line] of lines.entries()) {
    if (index >= maxLines) break;
    const lineBytes = Buffer.byteLength(line, "utf8") + (index > 0 ? 1 : 0);
    if (keptBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    kept.push(line);
    keptBytes += lineBytes;
  }

  if (kept.length >= maxLines && keptBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  return {
    content: kept.join("\n"),
    truncated: true,
    truncatedBy,
    totalLines,
    outputLines: kept.length,
    firstLineExceedsLimit: false,
  };
}

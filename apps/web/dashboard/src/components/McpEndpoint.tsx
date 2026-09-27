import { CopyButton } from "./CopyButton.js";

/**
 * An MCP URL and the one command that adds it, each with its copy button.
 *
 * Shared by the project's page, the project list and the account URL, so the
 * way to connect a client reads the same wherever it is offered.
 */
export function McpEndpoint({ url, copyLabel = "Copy" }: { url: string; copyLabel?: string }) {
  const claudeCode = `claude mcp add --transport http exeora ${url}`;

  return (
    <>
      <div className="border-border bg-bg flex items-center gap-3 rounded-lg border px-3 py-2.5">
        <code className="text-body-md text-foreground min-w-0 flex-1 truncate font-mono">
          {url}
        </code>
        <CopyButton value={url} label={copyLabel} />
      </div>

      <p className="text-body-md text-foreground-muted mt-4">
        Paste it into any MCP client that speaks Streamable HTTP, or add it from a terminal:
      </p>

      <div className="border-border bg-bg mt-2.5 flex items-center gap-3 rounded-lg border px-3 py-2.5">
        <code className="text-body-md text-foreground-muted min-w-0 flex-1 truncate font-mono">
          {claudeCode}
        </code>
        <CopyButton value={claudeCode} label="Copy command" />
      </div>
    </>
  );
}

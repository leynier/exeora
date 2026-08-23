import { CopyButton } from "./CopyButton.js";

/**
 * What to do when there is nothing here yet.
 *
 * Projects are added from the CLI, not from this screen, because only the
 * machine knows its own paths. `connect` signs in and keeps the machine
 * online; `exeora project add` registers a directory.
 */

const COMMAND = "exeora connect";
const ADD_PROJECT = "exeora project add";
const LINUX_INSTALL = "curl -fsSL https://exeora.dev/linux/install.sh | sh";
const MACOS_INSTALL = "curl -fsSL https://exeora.dev/macos/install.sh | sh";
const WINDOWS_INSTALL = "irm https://exeora.dev/windows/install.ps1 | iex";

export function Onboarding() {
  return (
    <div className="border-border bg-surface rounded-xl border p-7 sm:p-9">
      <h2 className="text-headline-sm">Connect your first machine</h2>
      <p className="text-body-lg text-foreground-muted mt-2">
        Run this on whichever machine holds the code. It dials out to Exeora, so there is nothing to
        open or forward. Add a project from any directory with a second command.
      </p>

      <div className="border-border bg-bg mt-6 flex items-center gap-3 rounded-lg border px-4 py-3">
        <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[15px]">
          {COMMAND}
        </code>
        <CopyButton value={COMMAND} />
      </div>

      <div className="border-border bg-bg mt-2 flex items-center gap-3 rounded-lg border px-4 py-3">
        <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[15px]">
          {ADD_PROJECT}
        </code>
        <CopyButton value={ADD_PROJECT} />
      </div>

      <p className="text-body-md text-foreground-muted mt-4">
        Connect opens your browser to sign in the first time, registers the machine, and keeps it
        online. Project add registers a directory and prints the MCP URL to paste into Claude,
        ChatGPT or Cursor. Leave connect running: nothing is served while it is not.
      </p>

      <div className="text-body-md text-foreground-faint border-border-subtle mt-7 space-y-2 border-t pt-5">
        <p>Install the CLI first:</p>
        <p className="break-all">
          <span className="text-foreground-muted">Linux:</span>{" "}
          <code className="font-mono">{LINUX_INSTALL}</code>
        </p>
        <p className="break-all">
          <span className="text-foreground-muted">macOS:</span>{" "}
          <code className="font-mono">{MACOS_INSTALL}</code>
        </p>
        <p className="break-all">
          <span className="text-foreground-muted">Windows PowerShell:</span>{" "}
          <code className="font-mono">{WINDOWS_INSTALL}</code>
        </p>
      </div>

      <p className="text-body-md text-foreground-faint mt-4">
        This page updates on its own once a machine connects.
      </p>
    </div>
  );
}

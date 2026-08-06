import { CopyButton } from "./CopyButton.js";

/**
 * What to do when there is nothing here yet.
 *
 * Projects are added from the CLI, not from this screen, because only the
 * machine knows its own paths. That used to mean five commands; `connect` now
 * signs in, registers the machine and registers the directory when any of
 * those is missing, so the empty dashboard hands over one line.
 */

const COMMAND = "npx @exeora/cli connect";

export function Onboarding() {
  return (
    <div className="border-border bg-surface rounded-xl border p-7 sm:p-9">
      <h2 className="text-headline-sm">Connect your first machine</h2>
      <p className="text-body-lg text-foreground-muted mt-2">
        Run this in the directory you want an agent to work on, on whichever machine holds it. It
        dials out to Exeora, so there is nothing to open or forward.
      </p>

      <div className="border-border bg-bg mt-6 flex items-center gap-3 rounded-lg border px-4 py-3">
        <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[15px]">
          {COMMAND}
        </code>
        <CopyButton value={COMMAND} />
      </div>

      <p className="text-body-md text-foreground-muted mt-4">
        It opens your browser to sign in the first time, registers the machine, and prints the MCP
        URL to paste into Claude, ChatGPT or Cursor. Leave it running: nothing is served while it is
        not.
      </p>

      <div className="text-body-md text-foreground-faint border-border-subtle mt-7 space-y-2 border-t pt-5">
        <p>Requires Node 22 or newer.</p>
        <p>
          To keep the binary on your PATH instead:{" "}
          <code className="font-mono">npm install -g @exeora/cli</code>, then{" "}
          <code className="font-mono">exeora connect</code>.
        </p>
      </div>

      <p className="text-body-md text-foreground-faint mt-4">
        This page updates on its own once a machine connects.
      </p>
    </div>
  );
}

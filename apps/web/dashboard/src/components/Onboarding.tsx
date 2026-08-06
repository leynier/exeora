import { CopyButton } from "./CopyButton.js";

/**
 * What to do when there is nothing here yet.
 *
 * Projects are added from the CLI, not from this screen, because only the
 * machine knows its own paths. So the empty dashboard has one job: hand over
 * the four commands that fill it.
 */

const steps = [
  // Scoped because npm would not give up the bare name; the binary it
  // installs is still `exeora`.
  { command: "npm install -g @exeora/cli", note: "Requires Node 22 or newer." },
  { command: "exeora login", note: "Opens this same sign-in in your browser." },
  { command: "exeora device register", note: "Names the machine you are on." },
  { command: "exeora project add .", note: "Prints the MCP URL for that directory." },
  { command: "exeora connect", note: "Leave it running. Nothing is served while it is not." },
];

export function Onboarding() {
  return (
    <div className="border-border bg-surface rounded-xl border p-7 sm:p-9">
      <h2 className="text-headline-sm">Connect your first machine</h2>
      <p className="text-body-lg text-foreground-muted mt-2">
        Run these on the machine you want an agent to work on. It dials out to Exeora, so there is
        nothing to open or forward.
      </p>

      <ol className="mt-7 space-y-4">
        {steps.map((step, index) => (
          <li key={step.command} className="flex gap-4">
            <span className="border-border text-label-md text-foreground-faint mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="border-border bg-bg flex items-center gap-3 rounded-lg border px-3 py-2">
                <code className="text-body-md text-foreground min-w-0 flex-1 truncate font-mono">
                  {step.command}
                </code>
                <CopyButton
                  value={step.command}
                  className="text-label-md text-foreground-muted hover:text-foreground border-border hover:border-foreground-faint/30 shrink-0 rounded-md border px-2 py-1 font-mono transition-colors duration-fast"
                />
              </div>
              <p className="text-body-md text-foreground-faint mt-1.5">{step.note}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-body-md text-foreground-faint border-border-subtle mt-7 border-t pt-5">
        This page updates on its own once a machine connects.
      </p>
    </div>
  );
}

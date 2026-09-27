import { type ReactNode, useState } from "react";
import { useGitHub, useMe } from "../queries.js";
import { AddProjectDialog } from "./AddProjectDialog.js";
import { CopyButton } from "./CopyButton.js";
import { ConnectGitHubButton } from "./GitHubConnect.js";

/**
 * What to do when there is nothing here yet.
 *
 * There are two ways to start and neither is the lesser one, so they sit side
 * by side: a project on a machine of your own, which begins in a terminal
 * because only the machine knows its own paths, and a project on Exeora Cloud,
 * which begins here.
 */

const CONNECT = "exeora connect";
const ADD_PROJECT = "exeora project add .";
const INSTALL = [
  { system: "Linux", command: "curl -fsSL https://exeora.dev/linux/install.sh | sh" },
  { system: "macOS", command: "curl -fsSL https://exeora.dev/macos/install.sh | sh" },
  { system: "Windows PowerShell", command: "irm https://exeora.dev/windows/install.ps1 | iex" },
];

export function Onboarding() {
  const me = useMe();
  const github = useGitHub();
  const [adding, setAdding] = useState(false);
  const canConnect = github.data?.enabled === true && !github.data.connected;

  return (
    <>
      {canConnect ? (
        <div className="border-border bg-surface mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-title-md">Optional first step: connect GitHub</p>
            <p className="text-body-md text-foreground-muted mt-0.5">
              Projects are then picked from a list of your repositories, with no address and no
              token to paste. Either path below works without it.
            </p>
          </div>
          <ConnectGitHubButton className="btn shrink-0" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Path
          title="Use my machine"
          lead="The code stays where it is. The machine dials out to Exeora, so there is nothing to open or forward."
        >
          <MachineSteps />
        </Path>

        <Path
          title="Use Exeora Cloud"
          lead="Exeora clones the repository onto an instance it runs, so an agent can work on it with no machine of yours switched on."
        >
          {me.data?.cloudEnabled ? (
            <>
              <ol className="text-body-md text-foreground-muted mt-5 list-decimal space-y-2 pl-5">
                <li>
                  {github.data?.connected
                    ? "GitHub is connected, so your repositories are there to pick from."
                    : "Pick a repository from GitHub, or give the address of any other Git server."}
                </li>
                <li>Exeora sets up an instance for it. That takes about a minute.</li>
                <li>Copy the project's MCP URL into Claude, ChatGPT or Cursor.</li>
              </ol>
              <button
                type="button"
                className="btn btn-primary mt-5"
                onClick={() => setAdding(true)}
              >
                Add project
              </button>
            </>
          ) : (
            <p className="text-body-md text-foreground-muted mt-5">
              Exeora Cloud is not enabled for this account. An administrator enables it.
            </p>
          )}
        </Path>
      </div>

      <p className="text-body-md text-foreground-faint mt-4">
        This page updates on its own once a project exists.
      </p>

      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function Path({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="border-border bg-surface rounded-xl border p-6 sm:p-7">
      <h2 className="text-headline-sm">{title}</h2>
      <p className="text-body-md text-foreground-muted mt-2">{lead}</p>
      {children}
    </section>
  );
}

/**
 * The three commands that put a project on a machine of your own. Shared with
 * the project list, which offers them to whoever has no project yet.
 */
export function MachineSteps() {
  return (
    <ol className="mt-5 space-y-4">
      <Step number={1} title="Install the CLI on the machine that holds the code">
        <div className="text-body-md text-foreground-faint mt-2 space-y-1.5">
          {INSTALL.map((entry) => (
            <p key={entry.system} className="break-all">
              <span className="text-foreground-muted">{entry.system}:</span>{" "}
              <code className="font-mono">{entry.command}</code>
            </p>
          ))}
        </div>
      </Step>
      <Step number={2} title="Connect the machine">
        <Command value={CONNECT} />
        <p className="text-body-md text-foreground-faint mt-2">
          It opens your browser to sign in the first time and keeps the machine online. Leave it
          running: nothing is served while it is not.
        </p>
      </Step>
      <Step number={3} title="Add a project from its directory">
        <Command value={ADD_PROJECT} />
        <p className="text-body-md text-foreground-faint mt-2">
          It prints the MCP URL to paste into Claude, ChatGPT or Cursor.
        </p>
      </Step>
    </ol>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="border-border text-label-md text-foreground-muted flex size-6 shrink-0 items-center justify-center rounded-full border font-mono"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-title-md">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Command({ value }: { value: string }) {
  return (
    <div className="border-border bg-bg mt-2 flex items-center gap-3 rounded-lg border px-3 py-2">
      <code className="text-foreground min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
      <CopyButton value={value} label="Copy" />
    </div>
  );
}

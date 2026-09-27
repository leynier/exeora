import type { User } from "../api.js";
import { cloudBlocker } from "../placement.js";
import { CopyButton } from "./CopyButton.js";

export type ProjectPlace = "cloud" | "machine";

/**
 * The second question of adding a project: where it lives first.
 *
 * On Exeora Cloud the dashboard can do it all. On one of the person's
 * machines it cannot, because only that machine can clone onto itself, so
 * the answer there is the one command to run, ready to copy.
 */
export function AddProjectWhere({
  place,
  user,
  repository,
  disabled,
  onChange,
}: {
  place: ProjectPlace;
  user: User | undefined;
  /** What the command names: `owner/name` from GitHub, or the address. */
  repository: string;
  disabled: boolean;
  onChange: (place: ProjectPlace) => void;
}) {
  const blocker = cloudBlocker(user);
  const command = `exeora project add ${repository}`;
  const option = "flex items-start gap-3 rounded-md px-3 py-2";

  return (
    <>
      <fieldset className="border-border mt-4 rounded-lg border p-1" disabled={disabled}>
        <legend className="text-label-md text-foreground-faint px-2">Where it lives first</legend>
        <label
          className={`${option} ${blocker ? "opacity-60" : "hover:bg-accent-subtle cursor-pointer"}`}
        >
          <input
            type="radio"
            name="place"
            className="accent-foreground mt-1"
            checked={place === "cloud"}
            disabled={blocker !== null}
            onChange={() => onChange("cloud")}
          />
          <span className="min-w-0">
            <span className="text-body-md text-foreground block">Exeora Cloud</span>
            <span className="text-body-md text-foreground-muted block">
              {blocker ??
                "Exeora clones it onto an instance it runs. The instance sleeps when idle and wakes on the next call."}
            </span>
          </span>
        </label>
        <label className={`${option} hover:bg-accent-subtle cursor-pointer`}>
          <input
            type="radio"
            name="place"
            className="accent-foreground mt-1"
            checked={place === "machine"}
            onChange={() => onChange("machine")}
          />
          <span className="min-w-0">
            <span className="text-body-md text-foreground block">One of my machines</span>
            <span className="text-body-md text-foreground-muted block">
              The machine clones it and serves it. Nothing leaves your hardware.
            </span>
          </span>
        </label>
      </fieldset>

      {place === "machine" ? (
        <div className="mt-4">
          <p className="text-body-md text-foreground-muted">
            Run this on the machine that should hold the project. It clones the repository into that
            machine's projects folder, and the project appears here once it has.
          </p>
          <div className="border-border bg-bg mt-2 flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <code className="text-body-md text-foreground min-w-0 flex-1 font-mono break-all">
              {command}
            </code>
            <CopyButton value={command} label="Copy command" />
          </div>
          <p className="text-body-md text-foreground-faint mt-2">
            The machine has to be connected first: install the CLI and run{" "}
            <code className="font-mono">exeora connect</code> on it.
          </p>
        </div>
      ) : null}
    </>
  );
}

import { relativeTime } from "../api.js";
import type { CloudInstance } from "../api-projects.js";
import { hookFact, toolsLines } from "../cloudHooks.js";
import { Fact } from "./MachineRow.js";

/**
 * What is behind "About this instance": its name and release, what became of
 * the project's scripts on it, and the tools it came with.
 *
 * Reference material, so it says everything, including what went well. What
 * needs somebody is on the row itself.
 */
export function InstanceFacts({ instance }: { instance: CloudInstance }) {
  const { hooks, tools } = instance;
  const lines = tools ? toolsLines(tools) : [];

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Instance">{instance.name}</Fact>
        <Fact label="CLI">{instance.cliVersion ?? "unknown"}</Fact>
        <Fact label="Ready">{instance.readyAt ? relativeTime(instance.readyAt) : "not yet"}</Fact>
        {hooks?.supported ? (
          <>
            {/* Words and not an address, so they break between words. */}
            <Fact label="Install script">
              <span className="break-normal">{hookFact(hooks.install)}</span>
            </Fact>
            <Fact label="Resume script">
              <span className="break-normal">{hookFact(hooks.resume)}</span>
            </Fact>
          </>
        ) : null}
        {lines.length > 0 ? (
          <Fact label="Tools" className="sm:col-span-3">
            {lines.map((line) => (
              <span key={line.label} className="block break-normal">
                <span className="text-foreground-faint">{line.label}:</span> {line.text}
              </span>
            ))}
          </Fact>
        ) : null}
      </dl>
      {hooks && !hooks.supported ? (
        <p className="text-body-md text-foreground-muted mt-3">
          Scripts do not run on this instance, which was made before they existed.
        </p>
      ) : null}
    </>
  );
}

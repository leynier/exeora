import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cloudApi } from "../api-cloud.js";
import type { CloudInstance, HookRun } from "../api-projects.js";
import type { CloudHook } from "../api-types.js";
import {
  hookWarning,
  isTroubled,
  noticedHooks,
  runningSentence,
  runRefusal,
  toolsNote,
} from "../cloudHooks.js";
import { instanceLabel } from "../projectModel.js";
import { keys, refreshPlaces } from "../queries.js";
import { useToast } from "./toast.js";

/** How often the list is asked again while a run that was asked for has not shown up. */
const ASK_AGAIN_MS = 3_000;

/** How long a run that was asked for is waited on before the row stops saying it is running. */
const GIVE_UP_MS = 30_000;

/** Whether the row of an instance has anything to say about its scripts or its tools. */
export function hasHookNotice(instance: CloudInstance): boolean {
  return noticedHooks(instance).length > 0 || instanceToolsNote(instance) !== null;
}

/** Said of an instance that works, and of no other: one that failed has its failure. */
function instanceToolsNote(instance: CloudInstance): string | null {
  return instance.state === "failed" || instance.state === "removing"
    ? null
    : toolsNote(instance.tools);
}

/**
 * What an instance that is ready still has to say: a script that failed or
 * ran out of time, one that is running, and the tools that are missing.
 *
 * A warning and not a failure, because the instance works. It goes in the
 * note of the row, and the words of a failed instance are left to the
 * instances that could not be made.
 */
export function HookNotice({ instance }: { instance: CloudInstance }) {
  const tools = instanceToolsNote(instance);
  return (
    <div className="space-y-2">
      {noticedHooks(instance).map(({ hook, run }) => (
        <HookRunNotice key={hook} instance={instance} hook={hook} run={run} />
      ))}
      {tools ? <p className="text-body-md text-foreground-muted">{tools}</p> : null}
    </div>
  );
}

function HookRunNotice({
  instance,
  hook,
  run,
}: {
  instance: CloudInstance;
  hook: CloudHook;
  run: HookRun;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // The run that was on screen when somebody asked for another. The instance
  // says a run began over its own connection, a moment after the gateway
  // answered, so the list still carries the old one for a while.
  const [asked, setAsked] = useState<string | null>(null);

  const again = useMutation({
    mutationFn: () => cloudApi.runHook(instance.deviceId, hook),
    onSuccess: () => {
      toast(`Running the ${hook} script again on ${instanceLabel(instance)}.`);
      setAsked(run.runId);
      void refreshPlaces(queryClient, instance.project.id);
    },
    onError: (error) => toast(runRefusal(error), "error"),
  });

  const waiting = asked === run.runId;
  useEffect(() => {
    if (asked === null) return;
    // The new run arrived, and says for itself what it is doing.
    if (!waiting) {
      setAsked(null);
      return;
    }
    const poll = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: keys.machines }),
      ASK_AGAIN_MS,
    );
    // Never forever: a run that does not show up leaves the button to press again.
    const giveUp = setTimeout(() => setAsked(null), GIVE_UP_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [asked, waiting, queryClient]);

  const running = run.status === "running" || waiting;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for a form, and this is a notice
    <div role="group" aria-label={`${hook === "install" ? "Install" : "Resume"} script`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          className={`text-body-md min-w-0 flex-1 ${running ? "text-foreground-muted" : "text-warning"}`}
        >
          {running ? runningSentence(hook) : hookWarning(hook, run)}
        </p>
        <button
          type="button"
          className="btn shrink-0"
          disabled={running || again.isPending}
          onClick={() => again.mutate()}
        >
          {again.isPending ? "Working…" : "Run again"}
        </button>
      </div>
      {!running && isTroubled(run) && run.output ? (
        <details className="mt-1">
          <summary className="text-body-md text-foreground-faint cursor-pointer">Details</summary>
          {run.truncated ? (
            <p className="text-body-md text-foreground-faint mt-2">Only the end is shown.</p>
          ) : null}
          <pre className="border-border bg-bg text-foreground-muted mt-2 max-h-48 overflow-auto rounded-lg border p-3 text-left font-mono text-xs whitespace-pre-wrap">
            {run.output}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

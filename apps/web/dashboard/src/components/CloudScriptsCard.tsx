import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { errorText, type Project } from "../api.js";
import { cloudApi } from "../api-cloud.js";
import type { CloudHook, CloudScripts } from "../api-types.js";
import {
  counterLine,
  draftOf,
  HOOK_HELP,
  HOOK_LABELS,
  HOOKS,
  inputOf,
  precedenceLine,
  type SaveRefusal,
  type ScriptsDraft,
  saveRefusal,
  scriptsChanged,
  sizeProblem,
} from "../cloudScripts.js";
import { keys, useCloudScripts } from "../queries.js";
import { useToast } from "./toast.js";
import { Card, SkeletonRows } from "./ui.js";

/**
 * The scripts a project runs inside its instances on Exeora Cloud.
 *
 * Two fields and a switch, because there are two moments worth a script and
 * two places to write one. The page replaces the repository, which is the
 * rule nobody guesses, so each field says under itself what will run as it
 * stands: the text in it, the file in the repository, or nothing.
 *
 * Saving changes no instance at that moment. Each is told the scripts the
 * next time it resumes, and the toast says so.
 */
export function CloudScriptsCard({ project }: { project: Project }) {
  const scripts = useCloudScripts(project.id);

  return (
    <Card
      title="Cloud scripts"
      subtitle="What this project runs inside its instances on Exeora Cloud."
    >
      {scripts.data ? (
        <ScriptsForm projectId={project.id} saved={scripts.data} />
      ) : scripts.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="text-body-md text-error min-w-0 flex-1">
            The scripts could not be loaded.{" "}
            {errorText(scripts.error, "The gateway did not answer.")} Try again in a moment.
          </p>
          <button type="button" className="btn shrink-0" onClick={() => void scripts.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <SkeletonRows count={2} />
      )}
    </Card>
  );
}

function ScriptsForm({ projectId, saved }: { projectId: string; saved: CloudScripts }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const switchId = useId();

  const [draft, setDraft] = useState<ScriptsDraft>(() => draftOf(saved));
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);

  const changed = scriptsChanged(draft, saved);
  const tooLarge = HOOKS.some((hook) => sizeProblem(hook, draft[hook]) !== null);

  async function save() {
    setSaving(true);
    setRefusal(null);
    try {
      const answer = await cloudApi.setScripts(projectId, inputOf(draft));
      queryClient.setQueryData(keys.cloudScripts(projectId), answer);
      // What the gateway kept, which is not always what was typed: it ends a
      // script with a new line and keeps nothing of a field of spaces.
      setDraft(draftOf(answer));
      toast("Scripts saved. Instances pick them up the next time they resume.");
    } catch (error) {
      const refused = saveRefusal(error);
      // A refusal about one script stays under its field until that field
      // changes. A toast is gone before a script can be read against it.
      if (refused.hook) setRefusal(refused);
      else toast(refused.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 p-5">
      {HOOKS.map((hook, index) => (
        <div key={hook} className={index > 0 ? "border-border border-t pt-4" : undefined}>
          <ScriptField
            hook={hook}
            value={draft[hook]}
            repository={draft.runRepositoryScripts}
            refused={refusal?.hook === hook ? refusal.message : null}
            onChange={(text) => {
              setDraft({ ...draft, [hook]: text });
              if (refusal?.hook === hook) setRefusal(null);
            }}
          />
        </div>
      ))}

      <div className="border-border flex gap-3 border-t pt-4">
        <input
          id={switchId}
          type="checkbox"
          className="mt-1"
          aria-describedby={`${switchId}-help`}
          checked={draft.runRepositoryScripts}
          onChange={(event) => setDraft({ ...draft, runRepositoryScripts: event.target.checked })}
        />
        <div>
          <label htmlFor={switchId} className="text-title-md">
            Run the scripts found in the repository
          </label>
          <p id={`${switchId}-help`} className="text-body-md text-foreground-muted mt-0.5">
            They run outside the project's policy and approvals: whoever can push to the branch runs
            code in the instance.
          </p>
        </div>
      </div>

      <div className="border-border flex items-center justify-between gap-4 border-t pt-4">
        <p className="text-body-md text-foreground-faint">
          A script that fails leaves the instance ready, with a warning on its row.
        </p>

        <button
          type="button"
          className="btn btn-primary shrink-0"
          disabled={!changed || saving || tooLarge}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ScriptField({
  hook,
  value,
  repository,
  refused,
  onChange,
}: {
  hook: CloudHook;
  value: string;
  /** Whether the files in the repository run, as the switch stands. */
  repository: boolean;
  /** What the gateway said of this script when it would not save it. */
  refused: string | null;
  onChange: (text: string) => void;
}) {
  const id = useId();
  const counter = counterLine(value);
  const problem = sizeProblem(hook, value) ?? refused;

  return (
    <>
      <label htmlFor={id} className="text-title-md">
        {HOOK_LABELS[hook]}
      </label>
      <p id={`${id}-help`} className="text-body-md text-foreground-muted mt-0.5">
        {HOOK_HELP[hook]}
      </p>
      <textarea
        id={id}
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-describedby={`${id}-help ${id}-runs`}
        aria-invalid={problem !== null}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono"
      />
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4">
        <p id={`${id}-runs`} className="text-body-md text-foreground-faint">
          {precedenceLine(hook, value, repository)}
        </p>
        {counter ? (
          <p
            className={`text-body-md tabular-nums ${sizeProblem(hook, value) ? "text-error" : "text-foreground-faint"}`}
          >
            {counter}
          </p>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-body-md text-error mt-1">
          {problem}
        </p>
      ) : null}
    </>
  );
}

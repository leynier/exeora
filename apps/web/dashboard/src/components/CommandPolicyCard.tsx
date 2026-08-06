import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type CommandPolicy, type Project, TOOL_NAMES, type ToolName } from "../api.js";
import { keys } from "../queries.js";
import { useToast } from "./toast.js";
import { Card } from "./ui.js";

/**
 * What an agent may do in this project.
 *
 * Three modes rather than a set of switches, because the useful answers are
 * few: let it do anything, let it only look, or name the commands it may run.
 * Anything more expressive would be a policy language, and a policy language
 * nobody can hold in their head is one people leave switched off.
 *
 * The machine can narrow this further with an `exeora.toml` of its own, never
 * widen it, which is why this screen describes what the account allows rather
 * than what will happen.
 */

const modes = [
  {
    value: "allow_all" as const,
    label: "Anything",
    body: "Every tool, and any command. What a project gets when no policy is set.",
  },
  {
    value: "read_only" as const,
    label: "Read only",
    body: "Reading, listing and searching. No edits, no writes, and no commands at all.",
  },
  {
    value: "allow_list" as const,
    label: "Listed commands",
    body: "Reads and edits, and only the commands you name below.",
  },
];

export function CommandPolicyCard({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState<CommandPolicy>(project.policy);
  const [saving, setSaving] = useState(false);

  // Compared as JSON because the shape is a handful of flat fields and this is
  // the only place that needs to know whether anything moved.
  const changed = JSON.stringify(draft) !== JSON.stringify(project.policy);

  /**
   * Turning the tool list on writes every tool rather than none.
   *
   * An empty list means "no tools at all", which is a real thing to want and a
   * terrible thing to arrive at by ticking a box. Starting from everything makes
   * the next click a restriction, which is what the person came here to make.
   */
  const setToolsRestricted = (restricted: boolean) =>
    setDraft({ ...draft, tools: restricted ? [...TOOL_NAMES] : null });

  const toggleTool = (tool: ToolName, on: boolean) => {
    const current = draft.tools ?? [...TOOL_NAMES];
    setDraft({
      ...draft,
      // Filtered from TOOL_NAMES rather than pushed, so the stored order is the
      // screen's order however the boxes were clicked.
      tools: TOOL_NAMES.filter((name) =>
        name === tool ? on : current.includes(name),
      ) as ToolName[],
    });
  };

  async function save() {
    setSaving(true);
    try {
      await api.setProjectPolicy(project.id, draft);
      await queryClient.invalidateQueries({ queryKey: keys.projects });
      toast("Policy saved. It applies to the next tool call.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="What agents may do here">
      <div className="space-y-4 p-5">
        <div className="space-y-2">
          {modes.map((mode) => (
            <label
              key={mode.value}
              className="border-border hover:bg-surface-variant flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors duration-fast"
            >
              <input
                type="radio"
                name="policy-mode"
                className="mt-1"
                checked={draft.mode === mode.value}
                onChange={() => setDraft({ ...draft, mode: mode.value })}
              />
              <div>
                <p className="text-title-md">{mode.label}</p>
                <p className="text-body-md text-foreground-muted mt-0.5">{mode.body}</p>
              </div>
            </label>
          ))}
        </div>

        {draft.mode === "allow_list" && (
          <div className="border-border space-y-4 border-t pt-4">
            <label className="block">
              <span className="text-body-md text-foreground-muted">
                Commands, one per line. A single word permits that program with any arguments;{" "}
                <code className="font-mono">git push</code> permits exactly that and nothing more,
                and a trailing <code className="font-mono">*</code> stands for whatever follows.
              </span>
              <textarea
                rows={5}
                value={draft.allow.join("\n")}
                onChange={(event) =>
                  setDraft({ ...draft, allow: splitCommands(event.target.value) })
                }
                placeholder={"npm\ngit *\ncargo build *"}
                className="border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono"
              />
            </label>
          </div>
        )}

        {/* Outside the mode block, because a deny list is the one rule that
            applies in every mode, and the only thing "Anything" can still say. */}
        {draft.mode !== "read_only" && (
          <div className="border-border border-t pt-4">
            <label className="block">
              <span className="text-body-md text-foreground-muted">
                Never run, one per line. Checked before the list above, in every mode. Same rules:{" "}
                <code className="font-mono">sudo</code> refuses that program outright,{" "}
                <code className="font-mono">git push *</code> refuses only those.
              </span>
              <textarea
                rows={3}
                value={draft.deny.join("\n")}
                onChange={(event) =>
                  setDraft({ ...draft, deny: splitCommands(event.target.value) })
                }
                placeholder={"sudo\nrm *\nshutdown"}
                className="border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono"
              />
            </label>
          </div>
        )}

        {/* Shown whenever a list is being compared against words, which is what
            shell syntax defeats. That is `allow_list`, and now also any project
            with a deny list. */}
        {(draft.mode === "allow_list" || draft.deny.length > 0) && (
          <div className="border-border space-y-4 border-t pt-4">
            <label className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.shell}
                onChange={(event) => setDraft({ ...draft, shell: event.target.checked })}
              />
              <div>
                <p className="text-title-md">Allow shell syntax</p>
                <p className="text-body-md text-foreground-muted mt-0.5">
                  Off by default, and worth leaving off. Commands run through a shell, so{" "}
                  <code className="font-mono">npm test; rm -rf ~</code> is one command whose first
                  word is <code className="font-mono">npm</code>. With this on, the lists above stop
                  being limits and become suggestions.
                </p>
              </div>
            </label>

            {draft.shell && (
              <p className="text-body-md text-error">
                With shell syntax allowed, anything permitted can reach anything else, and nothing
                denied is really denied. Turn it on only for a project you would have left on{" "}
                <em>Anything</em> regardless.
              </p>
            )}
          </div>
        )}

        <div className="border-border space-y-4 border-t pt-4">
          <label className="flex gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.tools !== null}
              onChange={(event) => setToolsRestricted(event.target.checked)}
            />
            <div>
              <p className="text-title-md">Choose which tools exist here</p>
              <p className="text-body-md text-foreground-muted mt-0.5">
                Off means every tool, including any added later. On names them one by one, which is
                the only way to say something like "edit files, never run a command".
              </p>
            </div>
          </label>

          {draft.tools !== null && (
            <div className="grid gap-2 sm:grid-cols-2">
              {TOOL_NAMES.map((tool) => (
                <label key={tool} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.tools?.includes(tool) ?? false}
                    onChange={(event) => toggleTool(tool, event.target.checked)}
                  />
                  <code className="text-body-md font-mono">{tool}</code>
                </label>
              ))}
            </div>
          )}

          {draft.tools?.length === 0 && (
            <p className="text-body-md text-error">
              With no tool selected this project answers nothing at all. That is a real thing to
              want, and rarely the thing someone meant.
            </p>
          )}
        </div>

        <div className="border-border border-t pt-4">
          <label className="flex gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.approve}
              onChange={(event) => setDraft({ ...draft, approve: event.target.checked })}
            />
            <div>
              <p className="text-title-md">Confirm every change</p>
              <p className="text-body-md text-foreground-muted mt-0.5">
                Asks before anything that edits, writes or runs, naming the file or the command.
                Reads are never interrupted, since a prompt nobody can decline is one people learn
                to click through.
              </p>
            </div>
          </label>

          {draft.approve && (
            <p className="text-body-md text-foreground-faint mt-3">
              A client speaking MCP 2026-07-28 is asked in the conversation itself. Claude and
              ChatGPT still speak the 2025 protocol today, so they are asked here and on the
              machine's terminal instead, whichever answers first. Nobody answering within ninety
              seconds refuses the call.
            </p>
          )}
        </div>

        <div className="border-border flex items-center justify-between gap-4 border-t pt-4">
          <p className="text-body-md text-foreground-faint">
            A machine can narrow this with its own <code className="font-mono">exeora.toml</code>.
            It can never widen it.
          </p>

          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={!changed || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Card>
  );
}

/** One command per line, tolerant of blank lines and stray spaces. */
function splitCommands(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

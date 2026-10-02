import { SplitButton } from "@exeora/design/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { errorText } from "../../api.js";
import { type AiProviderId, aiApi } from "../../api-ai.js";
import { type PullRequestRepository, prApi, prKeys } from "../../api-pr.js";
import { GenerateButton } from "../ai/GenerateButton.js";
import { fieldClass, fieldLabelClass } from "../Dialog.js";
import { Select } from "../Select.js";
import { useToast } from "../toast.js";
import type { WorkspaceContext } from "../workspace/context.js";

/**
 * Opening a pull request for the branch: a title that starts as the branch's
 * name, the base to merge into, a description, and whether it is a draft.
 * The branch is pushed first, so the request is made of what the machine has.
 */
export function CreatePullRequest({
  ctx,
  repository,
  branch,
}: {
  ctx: WorkspaceContext;
  repository: PullRequestRepository;
  branch: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(branch);
  const [body, setBody] = useState("");
  const [base, setBase] = useState(repository.defaultBranch);
  const fields = useRef({ title, body });
  fields.current = { title, body };
  const remotes = (ctx.status.data?.branches ?? [])
    .filter((item) => item.remote)
    .map((item) => item.name.replace(/^[^/]+\//, ""))
    .filter((name, index, all) => name !== branch && all.indexOf(name) === index);
  const bases = [
    repository.defaultBranch,
    ...remotes.filter((name) => name !== repository.defaultBranch),
  ];

  const create = useMutation({
    mutationFn: (draft: boolean) =>
      prApi.create(ctx.target.projectId, ctx.target.workspace, {
        title: title.trim(),
        body,
        base,
        head: branch,
        draft,
      }),
    onSuccess: async () => {
      toast("Pull request opened.");
      await client.invalidateQueries({
        queryKey: prKeys.lookup(ctx.target.projectId, ctx.target.targetKey, branch),
      });
      await client.invalidateQueries({
        queryKey: ["workspace", ctx.target.projectId, ctx.target.targetKey, "status"],
      });
    },
    onError: (error) => toast(errorText(error, "The pull request could not be opened."), "error"),
  });

  const generate = async (provider: AiProviderId | undefined, signal: AbortSignal) => {
    const started = fields.current;
    const result = await aiApi.pullRequest(
      ctx.target.projectId,
      provider,
      base,
      ctx.target.workspace,
      signal,
    );
    if (fields.current.title === started.title && fields.current.body === started.body) {
      setTitle(result.title);
      setBody(result.body);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) create.mutate(false);
      }}
    >
      <p className="text-body-md text-foreground-muted">
        No pull request for <span className="font-mono">{branch}</span> in {repository.fullName}.
      </p>
      <div className="relative mt-3">
        <label className="block">
          <span className={fieldLabelClass}>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={create.isPending}
            autoComplete="off"
            className={fieldClass}
          />
        </label>
        <div className="mt-1 flex justify-end">
          <GenerateButton
            operation="pull_request"
            label="Write the title and description"
            target={ctx.target}
            disabled={create.isPending}
            fieldValue={() => `${fields.current.title}\n${fields.current.body}`}
            generate={generate}
          />
        </div>
      </div>
      <div className="mt-3">
        <span className={fieldLabelClass}>Base branch</span>
        <div className="mt-2">
          <Select
            label="Base branch"
            value={base}
            options={bases.map((name) => ({ value: name, label: name }))}
            onChange={setBase}
            wide
            disabled={create.isPending}
          />
        </div>
      </div>
      <label className="mt-3 block">
        <span className={fieldLabelClass}>Description</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          placeholder="What changed, and why. Markdown is fine."
          disabled={create.isPending}
          className={`${fieldClass} resize-y`}
        />
      </label>
      <p className="text-label-md text-foreground-faint mt-2">
        The branch is pushed to origin first
        {ctx.status.data?.upstream ? "" : " and set to track it"}.
      </p>
      <SplitButton
        className="mt-3 w-full"
        label={create.isPending ? "Opening…" : "Create pull request"}
        disabled={create.isPending || !title.trim() || !base}
        busy={create.isPending}
        entries={[{ label: "Create draft pull request", onSelect: () => create.mutate(true) }]}
        menuLabel="More ways to open it"
        onClick={() => create.mutate(false)}
      />
    </form>
  );
}

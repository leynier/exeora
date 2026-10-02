import { IconButton, type MenuEntry, SplitButton } from "@exeora/design/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileDiff, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { errorText, relativeTime } from "../../api.js";
import {
  type MergeMethod,
  type PullRequest,
  type PullRequestRepository,
  prApi,
  prKeys,
} from "../../api-pr.js";
import { openExternalUrl } from "../../external-url.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { useToast } from "../toast.js";
import { Badge } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { Checks } from "./Checks.js";
import { Conversation } from "./Conversation.js";
import { EditPullRequestDialog } from "./EditPullRequestDialog.js";

const MERGE_LABELS: Record<MergeMethod, string> = {
  merge: "Merge",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

/**
 * One pull request: what it is, how it is doing, what has been said about
 * it, and what can be done to it from here.
 */
export function PullRequestView({
  ctx,
  repository,
  pullRequest,
  branch,
}: {
  ctx: WorkspaceContext;
  repository: PullRequestRepository;
  pullRequest: PullRequest;
  branch: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { projectId } = ctx.target;
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    label: string;
    run: () => void;
  } | null>(null);
  const lookupKey = prKeys.lookup(projectId, ctx.target.targetKey, branch);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: lookupKey }),
      client.invalidateQueries({ queryKey: prKeys.checks(projectId, pullRequest.number) }),
      client.invalidateQueries({ queryKey: prKeys.conversation(projectId, pullRequest.number) }),
    ]);
  const checks = useQuery({
    queryKey: prKeys.checks(projectId, pullRequest.number),
    queryFn: () => prApi.checks(projectId, pullRequest.number),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const act = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      setConfirm(null);
      void refresh();
    },
    onError: (error) => {
      setConfirm(null);
      toast(errorText(error, "GitHub refused."), "error");
    },
  });

  const open = pullRequest.state === "open" || pullRequest.state === "draft";
  const mergeable = pullRequest.mergeable === true && pullRequest.state === "open";
  const method = repository.mergeMethods[0];
  const primary =
    pullRequest.state === "draft"
      ? {
          label: "Mark ready for review",
          run: () =>
            act.mutate(() => prApi.update(projectId, pullRequest.number, { draft: false })),
        }
      : mergeable && method
        ? {
            label: MERGE_LABELS[method],
            run: () =>
              setConfirm({
                title: `${MERGE_LABELS[method]} #${pullRequest.number}?`,
                body: `${pullRequest.head.ref} goes into ${pullRequest.base.ref} on GitHub${repository.deleteBranchOnMerge ? ", and GitHub deletes the branch there" : ""}.`,
                label: MERGE_LABELS[method],
                run: () =>
                  act.mutate(() =>
                    prApi
                      .merge(projectId, pullRequest.number, method)
                      .then((r) => toast(r.message)),
                  ),
              }),
          }
        : {
            label: open ? "Refresh" : "Open on GitHub",
            run: () => (open ? void refresh() : openExternalUrl(pullRequest.url)),
          };

  const entries: MenuEntry[] = [
    ...repository.mergeMethods
      .filter((candidate) => candidate !== method || !mergeable)
      .map((candidate) => ({
        label: MERGE_LABELS[candidate],
        disabled: !mergeable,
        reason: pullRequest.state === "draft" ? "Still a draft" : "Not mergeable right now",
        onSelect: () =>
          setConfirm({
            title: `${MERGE_LABELS[candidate]} #${pullRequest.number}?`,
            body: `${pullRequest.head.ref} goes into ${pullRequest.base.ref} on GitHub.`,
            label: MERGE_LABELS[candidate],
            run: () =>
              act.mutate(() =>
                prApi.merge(projectId, pullRequest.number, candidate).then((r) => toast(r.message)),
              ),
          }),
      })),
    { separator: true },
    {
      label: pullRequest.state === "draft" ? "Mark ready for review" : "Convert to draft",
      disabled: !open,
      onSelect: () =>
        act.mutate(() =>
          prApi.update(projectId, pullRequest.number, { draft: pullRequest.state !== "draft" }),
        ),
    },
    {
      label: "Edit title or base",
      icon: Pencil,
      disabled: !open,
      onSelect: () => setEditing(true),
    },
    { separator: true },
    {
      label: "Close pull request",
      danger: true,
      disabled: !open,
      onSelect: () =>
        setConfirm({
          title: `Close #${pullRequest.number}?`,
          body: "The pull request is closed on GitHub without merging. It can be reopened there.",
          label: "Close",
          run: () => act.mutate(() => prApi.close(projectId, pullRequest.number)),
        }),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-border-subtle border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-title-md break-words">
              <span className="text-foreground-faint font-mono">#{pullRequest.number}</span>{" "}
              {pullRequest.title}
            </p>
            <p className="text-body-md text-foreground-faint mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge
                tone={
                  pullRequest.state === "merged"
                    ? "success"
                    : pullRequest.state === "closed"
                      ? "error"
                      : undefined
                }
              >
                {pullRequest.state}
              </Badge>
              <span>{pullRequest.author.login}</span>
              <span className="font-mono">
                {pullRequest.head.ref} → {pullRequest.base.ref}
              </span>
              <span>{relativeTime(Date.parse(pullRequest.updatedAt))}</span>
              <span className="tabular-nums">
                <span className="text-success">+{pullRequest.additions}</span>{" "}
                <span className="text-error">-{pullRequest.deletions}</span> ·{" "}
                {pullRequest.changedFiles} files
              </span>
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <IconButton
              label="Open on GitHub"
              icon={ExternalLink}
              size="sm"
              onClick={() => openExternalUrl(pullRequest.url)}
            />
            <IconButton
              label="Show the changes against the base"
              icon={FileDiff}
              size="sm"
              onClick={() => ctx.open({ kind: "range", base: pullRequest.base.ref }, true)}
            />
            <IconButton
              label="Refresh"
              icon={RefreshCw}
              size="sm"
              busy={checks.isFetching}
              onClick={() => void refresh()}
            />
          </div>
        </div>
        {open && pullRequest.mergeable === false ? (
          <p className="text-body-md text-warning mt-2">
            GitHub says it cannot be merged as is ({pullRequest.mergeableState}). Resolve the
            conflicts on the branch and push.
          </p>
        ) : null}
        <SplitButton
          className="mt-3 w-full"
          label={primary.label}
          disabled={act.isPending}
          busy={act.isPending}
          entries={entries}
          menuLabel="More pull request actions"
          onClick={primary.run}
        />
      </header>
      <Checks checks={checks.data} loading={checks.isLoading} error={checks.error} />
      <Conversation ctx={ctx} number={pullRequest.number} />
      <EditPullRequestDialog
        open={editing}
        pullRequest={pullRequest}
        bases={[
          repository.defaultBranch,
          ...(ctx.status.data?.branches ?? [])
            .filter((b) => b.remote)
            .map((b) => b.name.replace(/^[^/]+\//, "")),
        ].filter((name, i, all) => all.indexOf(name) === i && name !== branch)}
        pending={act.isPending}
        onSubmit={(patch) => {
          setEditing(false);
          act.mutate(() => prApi.update(projectId, pullRequest.number, patch));
        }}
        onCancel={() => setEditing(false)}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        pending={act.isPending}
        onConfirm={() => confirm?.run()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

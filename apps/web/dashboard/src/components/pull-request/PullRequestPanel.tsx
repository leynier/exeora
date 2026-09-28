import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { prApi, prKeys } from "../../api-pr.js";
import { useGitHub } from "../../queries.js";
import { EmptyState, ErrorBanner, Skeleton } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { CreatePullRequest } from "./CreatePullRequest.js";
import { PullRequestView } from "./PullRequestView.js";

/** How often the pull request is asked about while the view is on screen. */
const POLL_MS = 60_000;

/**
 * The pull request of the branch on screen, or the form that makes one.
 *
 * GitHub only, through the account connected in Settings: a project whose
 * remote is elsewhere, or an account without GitHub, is told so rather than
 * shown an empty form.
 */
export function PullRequestPanel({ ctx }: { ctx: WorkspaceContext }) {
  const github = useGitHub();
  const branch = ctx.status.data?.head ?? null;
  const lookup = useQuery({
    queryKey: prKeys.lookup(ctx.target.projectId, ctx.target.targetKey, branch),
    queryFn: () => prApi.lookup(ctx.target.projectId, ctx.target.workspace, branch),
    enabled: github.data?.enabled === true && github.data.connected,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  if (github.isLoading) return <Skeleton className="m-4 h-24 w-[calc(100%-2rem)]" />;
  if (!github.data?.enabled) {
    return (
      <EmptyState title="GitHub is not set up here">
        Pull requests need the GitHub app on this gateway.
      </EmptyState>
    );
  }
  if (!github.data.connected) {
    return (
      <EmptyState title="Connect GitHub first">
        Pull requests are read and opened with your GitHub account.{" "}
        <Link to="/settings" className="underline">
          Connect it in Settings
        </Link>
        .
      </EmptyState>
    );
  }
  if (lookup.isError)
    return <ErrorBanner error={lookup.error} onRetry={() => void lookup.refetch()} />;
  if (!lookup.data) return <Skeleton className="m-4 h-24 w-[calc(100%-2rem)]" />;
  if (lookup.data.reason === "not_github" || !lookup.data.repository) {
    return (
      <EmptyState title="Not a GitHub repository">
        This project's remote is not on GitHub, so there is no pull request to show.
      </EmptyState>
    );
  }
  if (!branch) {
    return (
      <EmptyState title="Detached HEAD">
        Check out a branch to see or open its pull request.
      </EmptyState>
    );
  }
  const { repository, pullRequest, pending } = lookup.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pending.length > 0 ? (
        <p className="text-body-md text-warning border-border-subtle border-b px-4 py-2">
          GitHub has not yet granted the app {pending.join(", ")} for this installation; some of
          this view may be missing until an owner accepts them on GitHub.
        </p>
      ) : null}
      {pullRequest ? (
        <PullRequestView
          ctx={ctx}
          repository={repository}
          pullRequest={pullRequest}
          branch={branch}
        />
      ) : (
        <CreatePullRequest ctx={ctx} repository={repository} branch={branch} />
      )}
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { errorText } from "../api.js";
import { type GitHubInstallation, projectsApi } from "../api-projects.js";
import { keys, useGitHub } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ConnectGitHubButton } from "./GitHubConnect.js";
import { useToast } from "./toast.js";
import { Badge, Card, Divided, Row } from "./ui.js";

/** Why connecting failed, for the reasons GitHub's way back is known to give. */
const FAILURES: Record<string, string> = {
  denied: "GitHub was not connected: the installation was cancelled.",
  state_invalid:
    "GitHub was not connected: the request took too long or was already used. Try again.",
  state_used: "That link was already used. Start the connection again from here.",
  session_required:
    "GitHub was not connected: finish it in the browser where you are signed in to Exeora, then try again.",
  approval_pending:
    "The installation is waiting for an owner of that organisation to approve it. Connect again once they have.",
  installation_not_visible:
    "GitHub was not connected: your GitHub account cannot see that installation.",
  installation_invalid: "GitHub was not connected: the installation could not be read. Try again.",
  no_installation: "GitHub was not connected: the app is not installed on any account you can see.",
  code_missing: "GitHub was not connected: GitHub did not confirm who you are. Try again.",
  code_rejected: "GitHub was not connected: GitHub did not confirm who you are. Try again.",
  github_unavailable: "GitHub did not answer. Try again in a moment.",
};

/**
 * Says how the trip to github.com ended, once, and takes the answer out of the
 * address so a reload does not say it again.
 */
function useGitHubReturn() {
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const outcome = search.get("github");
  const reason = search.get("reason");

  useEffect(() => {
    if (outcome === null) return;
    if (outcome === "connected") {
      toast("GitHub is connected. Its repositories are there to pick from when adding a project.");
    } else {
      toast(
        (reason && FAILURES[reason]) ??
          `GitHub was not connected${reason ? `: ${reason.replaceAll("_", " ")}` : ""}. Try again.`,
        "error",
      );
    }
    void queryClient.invalidateQueries({ queryKey: keys.github });
    const rest = new URLSearchParams(search);
    rest.delete("github");
    rest.delete("reason");
    setSearch(rest, { replace: true });
  }, [outcome, reason, search, setSearch, toast, queryClient]);
}

/**
 * The connection to GitHub: what it gives, which accounts it reaches, and the
 * way out of it.
 *
 * Nothing is drawn on a gateway that has no GitHub app. There a card would
 * offer something that cannot be had.
 */
export function GitHubCard({ className = "" }: { className?: string }) {
  useGitHubReturn();
  const github = useGitHub();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [leaving, setLeaving] = useState<GitHubInstallation | null>(null);

  const disconnect = useMutation({
    mutationFn: (installation: GitHubInstallation) => projectsApi.disconnectGitHub(installation.id),
    onSuccess: (_result, installation) => {
      toast(
        `${installation.accountLogin} is disconnected. The app is still installed on GitHub, and is removed there.`,
      );
      setLeaving(null);
      void queryClient.invalidateQueries({ queryKey: keys.github });
      void queryClient.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
    onError: (error) => {
      toast(errorText(error, "GitHub could not be disconnected."), "error");
      setLeaving(null);
    },
  });

  // Nothing while it loads, either: a card that appears and then vanishes on a
  // gateway without GitHub is worse than one that arrives a moment late.
  if (!github.data?.enabled) return null;

  const { installations } = github.data;

  return (
    <>
      <Card
        title="GitHub"
        subtitle={
          github.data.connected
            ? "The accounts whose repositories can be added as projects."
            : undefined
        }
        action={
          github.data.connected ? (
            <ConnectGitHubButton className="btn shrink-0" label="Connect another account" />
          ) : undefined
        }
        className={className}
      >
        {!github.data.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <p className="text-body-md text-foreground-muted min-w-0 flex-1">
              {github.data.reconnect
                ? "GitHub no longer honours the connection this account had, which happens when it is revoked there or left unused for months. Connect again to keep picking repositories and to let machines fetch and push."
                : "Connecting GitHub lets you add a project by picking a repository from a list, and lets Exeora Cloud fetch and push without a token of yours. You choose on GitHub which repositories Exeora is given."}
            </p>
            <ConnectGitHubButton className="btn btn-primary shrink-0" />
          </div>
        ) : (
          <Divided>
            {installations.map((installation) => (
              <Row key={installation.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-title-md truncate">{installation.accountLogin}</p>
                    <Badge>
                      {installation.repositorySelection === "all"
                        ? "all repositories"
                        : "selected repositories"}
                    </Badge>
                    {installation.suspended && <Badge tone="error">suspended</Badge>}
                  </div>
                  <p className="text-body-md text-foreground-faint">
                    {installation.accountType === "Organization" ? "Organisation" : "Account"}
                    {installation.suspended
                      ? " · suspended on GitHub, so nothing of it can be read until it is resumed there"
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <a className="btn" href={installation.manageUrl} target="_blank" rel="noreferrer">
                    Change repositories
                  </a>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={disconnect.isPending}
                    onClick={() => setLeaving(installation)}
                  >
                    Disconnect
                  </button>
                </div>
              </Row>
            ))}
          </Divided>
        )}
      </Card>

      <ConfirmDialog
        open={leaving !== null}
        title={`Disconnect ${leaving?.accountLogin ?? ""}?`}
        body="Projects keep working with the credentials each machine already has. Cloud instances will no longer be able to fetch or push until GitHub is reconnected."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        onCancel={() => setLeaving(null)}
        onConfirm={() => leaving && disconnect.mutate(leaving)}
      />
    </>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type {
  GitStatus,
  Project,
  ProjectLocation,
  Workspace,
  WorkspaceAction,
  WorkspaceMutationResult,
} from "../../api.js";
import { aiApi, aiKeys } from "../../api-ai.js";
import { createdSlug } from "../../api-projects.js";
import type { FileWritten } from "../../api-types-workspace.js";
import { keys, useGitHub, useMe } from "../../queries.js";
import type { Target } from "../../queries-workspace.js";
import type { LocationRoot } from "../../workspacePaths.js";
import { AddWorkspaceDialog } from "../AddWorkspaceDialog.js";
import { CommitAssist } from "../ai/CommitAssist.js";
import { ShipDialog } from "../ship/ShipDialog.js";
import { EmptyState, ErrorBanner, Skeleton } from "../ui.js";
import type { WorkspaceSelection } from "../WorkspaceFileGroup.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { useAccountFeatures } from "../workspace/surface.js";
import type { Confirmation } from "../workspace/useWorkspaceActions.js";
import type { Detail } from "../workspace/workspaceLayout.js";
import { workspacePrefs } from "../workspace/workspacePrefs.js";
import { actionMenu, type MenuCommand } from "./actionMenu.js";
import { Changes, inChunks } from "./Changes.js";
import { CommitBox } from "./CommitBox.js";
import { History } from "./History.js";
import type { PrimaryActionId } from "./primaryAction.js";
import { SourceControlToolbar } from "./SourceControlToolbar.js";
import { StashList } from "./StashList.js";

export type SourceControlActions = {
  pending: boolean;
  run: (
    actions: WorkspaceAction | WorkspaceAction[],
  ) => Promise<WorkspaceMutationResult | FileWritten | null>;
  setConfirm: (confirm: Confirmation) => void;
};

/**
 * The git client's list side: branch and toolbar, the message and the
 * button, what is staged and what changed, the stashes, the history.
 *
 * What is picked here opens elsewhere: beside the list on a wide screen,
 * over it on a narrow one. The container that owns both says how through
 * `onOpen`, and highlights what is open through `selected`.
 */
export function SourceControl({
  ctx,
  target,
  workspaces,
  root,
  project,
  where,
  status,
  loading,
  error,
  v2,
  actions,
  selected,
  onOpen,
  onSelectWorkspace,
}: {
  ctx: WorkspaceContext;
  target: Target;
  /** The workspaces on the machine whose git status this is, and no others. */
  workspaces: Workspace[];
  /** The root of the location on screen, which is what its git status lists. */
  root: LocationRoot;
  project: Project;
  /** The location of what is on screen, which is where a new workspace starts out. */
  where: ProjectLocation | undefined;
  status?: GitStatus;
  loading: boolean;
  error: unknown;
  /** The CLI announced `source-control-v2`: history, stash, amend, whole diffs. */
  v2: boolean;
  actions: SourceControlActions;
  selected: Detail | null;
  onOpen: (detail: Detail, pin?: boolean) => void;
  onSelectWorkspace: (slug: string | null) => void;
}) {
  const client = useQueryClient();
  const me = useMe();
  const [commitMessage, setCommitMessage] = useState("");
  const messageRef = useRef("");
  messageRef.current = commitMessage;
  const [tree, setTree] = useState(workspacePrefs.changesTree.read);
  const [history, setHistory] = useState(workspacePrefs.historyOpen.read);
  /** The branch typed into the picker, while the dialog that takes it is open. */
  const [creatingWorkspace, setCreatingWorkspace] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  const { pending, run, setConfirm } = actions;
  const account = useAccountFeatures();
  const github = useGitHub(account);
  const ai = useQuery({
    queryKey: aiKeys.status,
    queryFn: aiApi.status,
    staleTime: 60_000,
    enabled: account,
  });
  const assistant = ai.data?.enabled && ai.data.providers.some((provider) => provider.linked);
  const ship: string | true | undefined = !assistant
    ? undefined
    : !github.data?.connected
      ? "Connect GitHub in Settings"
      : status?.remotes.length === 0
        ? "No remote to push to"
        : true;

  const staged = useMemo(
    () => status?.files.filter((file) => file.index !== "." && file.index !== "?") ?? [],
    [status],
  );
  const changes = useMemo(
    () => status?.files.filter((file) => file.worktree !== "." || file.kind === "untracked") ?? [],
    [status],
  );

  if (loading) return <Skeleton className="h-full w-full" />;
  if (error) return <ErrorBanner error={error} onRetry={() => void ctx.refresh.manual()} />;
  if (!status?.repository)
    return (
      <EmptyState title="Not a Git repository">
        Initialize Git from the terminal, then refresh this view.
      </EmptyState>
    );

  const subject = commitMessage.trim().split("\n")[0] ?? "";
  const messageReady = subject.length > 0;
  const selection: WorkspaceSelection | null =
    selected?.kind === "diff" ? { path: selected.path, area: selected.area } : null;

  const commit = async (then: WorkspaceAction[] = []) => {
    const result = await run([{ action: "commit", message: commitMessage }, ...then]);
    if (result) setCommitMessage("");
  };
  const publish = (): WorkspaceAction =>
    status.upstream || !status.remotes[0]
      ? { action: "push" }
      : { action: "push", remote: status.remotes[0], setUpstream: true };
  const sync = (): WorkspaceAction[] =>
    v2 ? [{ action: "sync" }] : [{ action: "pull" }, { action: "push" }];

  const onPrimary = (id: PrimaryActionId) => {
    const commands: Record<PrimaryActionId, () => void> = {
      commit: () => void commit(),
      fetch: () => void run({ action: "fetch", all: true }),
      publish: () => void run(publish()),
      sync: () => void run(sync()),
      pull: () => void run({ action: "pull" }),
      push: () => void run({ action: "push" }),
      stage_all: () => void run(inChunks("stage", changes)),
    };
    commands[id]();
  };

  const onCommand = (command: MenuCommand) => {
    switch (command) {
      case "commit":
        return void commit();
      case "commit_push":
        return void commit([publish()]);
      case "commit_sync":
        return void commit(sync());
      case "amend": {
        const amend = messageReady
          ? { action: "amend" as const, message: commitMessage }
          : { action: "amend" as const };
        const published = status.upstream !== null && status.ahead === 0;
        if (published) {
          return setConfirm({
            action: amend,
            title: "Amend a pushed commit?",
            body: "The last commit is already on the upstream. Amending rewrites it, and the next push will need to be forced from a terminal.",
            label: "Amend",
          });
        }
        return void run(amend).then((result) => {
          if (result) setCommitMessage("");
        });
      }
      case "stage_all":
        return void run(inChunks("stage", changes));
      case "unstage_all":
        return void run(inChunks("unstage", staged));
      case "discard_all":
        return setConfirm({
          action: { action: "discard_all" },
          title: "Discard every local change?",
          body: "Uncommitted changes in every tracked file cannot be recovered by Exeora. Untracked files stay.",
          label: "Discard all",
        });
      case "fetch":
        return void run({ action: "fetch", all: true });
      case "pull":
        return void run({ action: "pull" });
      case "push":
        return void run({ action: "push" });
      case "sync":
        return void run(sync());
      case "publish":
        return void run(publish());
      case "stash":
        return void run(
          messageReady ? { action: "stash_push", message: subject } : { action: "stash_push" },
        );
      case "stash_pop":
        return void run({ action: "stash_pop" });
      case "ship":
        return setShipping(true);
    }
  };

  const changeActions = {
    pending,
    onOpen: (item: WorkspaceSelection, pin?: boolean) =>
      onOpen({ kind: "diff", area: item.area, path: item.path }, pin),
    onRun: (batch: WorkspaceAction | WorkspaceAction[]) => void run(batch),
    onConfirm: setConfirm,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceControlToolbar
        status={status}
        pending={pending}
        root={root}
        workspaces={workspaces}
        v2={v2}
        tree={tree}
        history={history}
        refreshing={ctx.refresh.refreshing || ctx.status.isFetching}
        autoRefresh={ctx.refresh.auto}
        onRun={(action) => run(action).then(() => undefined)}
        onRefresh={() => void ctx.refresh.manual()}
        onAutoRefreshChange={ctx.refresh.setAuto}
        onToggleTree={() => setTree(workspacePrefs.changesTree.write(!tree))}
        onToggleHistory={() => setHistory(workspacePrefs.historyOpen.write(!history))}
        onAllChanges={() =>
          onOpen({ kind: "diffall", area: staged.length > 0 ? "staged" : "working" }, true)
        }
        onSelectWorkspace={onSelectWorkspace}
        onCreateWorkspace={setCreatingWorkspace}
        onConfirmDelete={(name) =>
          setConfirm({
            action: { action: "branch_delete", name },
            title: "Delete local branch?",
            body: `Git will only delete ${name} if it is fully merged. Remote branches are never deleted here.`,
            label: "Delete branch",
          })
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CommitBox
          message={commitMessage}
          onMessageChange={setCommitMessage}
          status={status}
          pending={pending}
          entries={actionMenu(
            status,
            { messageReady, v2, pending, ...(ship !== undefined ? { ship } : {}) },
            onCommand,
          )}
          onPrimary={onPrimary}
          assist={
            <CommitAssist
              target={target}
              staged={staged.length}
              conflicts={status.files.some((file) => file.kind === "conflict")}
              pending={pending}
              value={() => messageRef.current}
              onChange={setCommitMessage}
            />
          }
        />
        <Changes
          title="Staged"
          files={staged}
          area="staged"
          selected={selection}
          tree={tree}
          actions={changeActions}
        />
        <Changes
          title="Changes"
          files={changes}
          area="working"
          selected={selection}
          tree={tree}
          actions={changeActions}
        />
        {v2 ? (
          <StashList
            target={target}
            count={status.stashes ?? 0}
            pending={pending}
            onPop={(index) => void run({ action: "stash_pop", index })}
            onConfirm={setConfirm}
          />
        ) : null}
        {v2 ? (
          <History
            target={target}
            open={history}
            selectedOid={selected && "oid" in selected ? selected.oid : null}
            onOpen={(entry) => onOpen({ kind: "commit", oid: entry.oid })}
          />
        ) : null}
      </div>
      <ShipDialog ctx={ctx} open={shipping} onClose={() => setShipping(false)} />
      <AddWorkspaceDialog
        open={creatingWorkspace !== null}
        project={project}
        user={me.data}
        initialBranch={creatingWorkspace ?? ""}
        // On a machine the new branch starts from what is checked out here,
        // which is what somebody branching from this view means. An instance
        // clones from the remote, which may not have this branch yet.
        initialFrom={where?.kind === "local" ? (status.head ?? "") : ""}
        initialWhere={where?.slug}
        onCancel={() => setCreatingWorkspace(null)}
        onCreated={async (result) => {
          setCreatingWorkspace(null);
          // An instance takes a minute to set up and is listed with its state
          // until then. A working copy on a machine is there already.
          if (result.status !== "ready") return;
          await client.invalidateQueries({ queryKey: keys.workspaces(target.projectId) });
          onSelectWorkspace(createdSlug(result));
        }}
      />
    </div>
  );
}

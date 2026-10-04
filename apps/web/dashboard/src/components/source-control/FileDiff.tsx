import { IconButton } from "@exeora/design/react";
import { Minus, Plus, Trash, Undo2 } from "lucide-react";
import type { GitStatus, WorkspaceAction } from "../../api.js";
import type { DiffArea } from "../../api-types-workspace.js";
import { type Target, useCommitDiff, useDiffAll, useFileDiff } from "../../queries-workspace.js";
import { fileStatusClass, fileStatusCode } from "../WorkspaceFileGroup.js";
import { DiffView } from "./DiffView.js";

/** The diff of one changed file, with what can be done to it above. */
export function WorkingFileDiff({
  target,
  path,
  area,
  status,
  pending,
  onRun,
  onConfirm,
}: {
  target: Target;
  path: string;
  area: DiffArea;
  status: GitStatus | undefined;
  pending: boolean;
  onRun: (action: WorkspaceAction) => void;
  onConfirm: (confirm: {
    action: WorkspaceAction;
    title: string;
    body: string;
    label: string;
  }) => void;
}) {
  const file = status?.files.find((item) => item.path === path);
  const diff = useFileDiff(target, path, area, Boolean(status?.repository));
  const code = file ? fileStatusCode(file, area) : null;
  return (
    <DiffView
      patch={diff.data?.patch}
      loading={diff.isLoading}
      binary={diff.data?.binary}
      truncated={diff.data?.truncated}
      comment={{ area, commit: null }}
      toolbar={
        <>
          {code && file ? (
            <span
              className={`text-label-md mr-auto font-mono uppercase ${fileStatusClass(code, file.kind)}`}
            >
              {area === "staged" ? "Staged" : "Working tree"} · {code}
            </span>
          ) : null}
          {area === "working" && file?.kind === "untracked" ? (
            <IconButton
              label="Delete untracked file"
              icon={Trash}
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                onConfirm({
                  action: { action: "delete_untracked", paths: [path] },
                  title: "Delete untracked file?",
                  body: `${path} will be permanently deleted from the machine that holds this workspace.`,
                  label: "Delete file",
                })
              }
            />
          ) : area === "working" ? (
            <IconButton
              label="Discard changes"
              icon={Undo2}
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                onConfirm({
                  action: { action: "discard", paths: [path] },
                  title: "Discard local changes?",
                  body: `Uncommitted changes in ${path} cannot be recovered by Exeora.`,
                  label: "Discard changes",
                })
              }
            />
          ) : null}
          {area === "working" ? (
            <IconButton
              label="Stage"
              icon={Plus}
              size="sm"
              disabled={pending || !file}
              onClick={() => onRun({ action: "stage", paths: [path] })}
            />
          ) : (
            <IconButton
              label="Unstage"
              icon={Minus}
              size="sm"
              disabled={pending || !file}
              onClick={() => onRun({ action: "unstage", paths: [path] })}
            />
          )}
        </>
      }
    />
  );
}

/** Every change in an area as one patch. */
export function AllChangesDiff({ target, area }: { target: Target; area: DiffArea }) {
  const diff = useDiffAll(target, area);
  return (
    <DiffView
      patch={diff.data?.patch}
      loading={diff.isLoading}
      truncated={diff.data?.truncated}
      comment={{ area, commit: null }}
      note={
        diff.data?.untrackedOmitted
          ? "Untracked files did not fit under the output limit and are left out."
          : undefined
      }
      emptyTitle={area === "staged" ? "Nothing staged" : "Working tree clean"}
      emptyBody="There is no change to show in this area."
    />
  );
}

/** What a commit did to one file, or to all of them. */
export function CommitFileDiff({
  target,
  oid,
  path,
}: {
  target: Target;
  oid: string;
  path: string | null;
}) {
  const diff = useCommitDiff(target, oid, path);
  return (
    <DiffView
      patch={diff.data?.patch}
      loading={diff.isLoading}
      binary={diff.data?.binary}
      truncated={diff.data?.truncated}
      comment={{ area: null, commit: oid }}
      emptyTitle="No textual diff"
      emptyBody="The commit changed nothing textual here."
    />
  );
}

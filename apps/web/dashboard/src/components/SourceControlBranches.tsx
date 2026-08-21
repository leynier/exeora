import { useState } from "react";
import type { GitStatus, WorkspaceAction } from "../api.js";
import { Select } from "./Select.js";

export function SourceControlBranches({
  status,
  pending,
  onRun,
  onConfirmDelete,
}: {
  status: GitStatus;
  pending: boolean;
  onRun: (action: WorkspaceAction) => Promise<void>;
  onConfirmDelete: (name: string) => void;
}) {
  const [branchName, setBranchName] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [deleteBranch, setDeleteBranch] = useState("");
  const local = status.branches.filter((branch) => !branch.remote);
  const remote = status.branches.filter((branch) => branch.remote);
  const deletable = local.filter((branch) => !branch.current);

  return (
    <section className="p-3">
      <h2 className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
        Branches
      </h2>
      <div className="mt-2">
        <Select
          label="Current branch"
          value={status.head ?? ""}
          options={local.map((branch) => ({
            value: branch.name,
            label: branch.name,
            hint: branch.current ? "current" : branch.shortOid,
          }))}
          placeholder="detached HEAD"
          disabled={pending || local.length === 0}
          wide
          onChange={(name) => {
            void onRun({ action: "branch_switch", name });
          }}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          placeholder="new-branch"
          className="border-border bg-bg min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          className="btn"
          disabled={pending || !branchName.trim()}
          onClick={() =>
            void onRun({ action: "branch_create", name: branchName.trim() }).then(() =>
              setBranchName(""),
            )
          }
        >
          Create
        </button>
      </div>
      {remote.length > 0 && (
        <div className="mt-2 flex gap-2">
          <div className="min-w-0 flex-1">
            <Select
              label="Track remote branch"
              value={remoteBranch}
              options={[
                { value: "", label: "Track remote…" },
                ...remote.map((branch) => ({ value: branch.name, label: branch.name })),
              ]}
              disabled={pending}
              wide
              onChange={setRemoteBranch}
            />
          </div>
          <button
            type="button"
            className="btn"
            disabled={pending || !remoteBranch}
            onClick={() =>
              void onRun({
                action: "branch_track",
                remoteBranch,
                name: remoteBranch.split("/").slice(1).join("/"),
              })
            }
          >
            Track
          </button>
        </div>
      )}
      {deletable.length > 0 && (
        <div className="mt-2 flex gap-2">
          <div className="min-w-0 flex-1">
            <Select
              label="Delete local branch"
              value={deleteBranch}
              options={[
                { value: "", label: "Delete local…" },
                ...deletable.map((branch) => ({ value: branch.name, label: branch.name })),
              ]}
              disabled={pending}
              wide
              onChange={setDeleteBranch}
            />
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending || !deleteBranch}
            onClick={() => onConfirmDelete(deleteBranch)}
          >
            Delete
          </button>
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import type { PullRequest } from "../../api-pr.js";
import { Dialog, DialogActions, Field, fieldLabelClass } from "../Dialog.js";
import { Select } from "../Select.js";

/** The title and the base, the two things GitHub lets a pull request change after the fact. */
export function EditPullRequestDialog({
  open,
  pullRequest,
  bases,
  pending,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pullRequest: PullRequest;
  bases: string[];
  pending: boolean;
  onSubmit: (patch: { title?: string; base?: string }) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title={`Edit #${pullRequest.number}`} onCancel={onCancel}>
      <EditForm
        pullRequest={pullRequest}
        bases={bases}
        pending={pending}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </Dialog>
  );
}

function EditForm({
  pullRequest,
  bases,
  pending,
  onSubmit,
  onCancel,
}: {
  pullRequest: PullRequest;
  bases: string[];
  pending: boolean;
  onSubmit: (patch: { title?: string; base?: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(pullRequest.title);
  const [base, setBase] = useState(pullRequest.base.ref);
  const options = [pullRequest.base.ref, ...bases.filter((name) => name !== pullRequest.base.ref)];
  const changed = title.trim() !== pullRequest.title || base !== pullRequest.base.ref;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || !title.trim()) return;
        onSubmit({
          ...(title.trim() !== pullRequest.title ? { title: title.trim() } : {}),
          ...(base !== pullRequest.base.ref ? { base } : {}),
        });
      }}
    >
      <Field label="Title" value={title} onChange={setTitle} disabled={pending} autoFocus />
      <div className="mt-3">
        <span className={fieldLabelClass}>Base branch</span>
        <div className="mt-2">
          <Select
            label="Base branch"
            value={base}
            options={options.map((name) => ({ value: name, label: name }))}
            onChange={setBase}
            wide
            disabled={pending}
          />
        </div>
      </div>
      <DialogActions>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !changed || !title.trim()}
        >
          Save
        </button>
      </DialogActions>
    </form>
  );
}

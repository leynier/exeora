import { useState } from "react";
import { Dialog, DialogActions, Field } from "../Dialog.js";
import { Select } from "../Select.js";
import { baseName, joinPath, validName } from "./explorerModel.js";

export type NameRequest =
  | { kind: "create"; type: "file" | "directory"; dir: string }
  | { kind: "rename"; path: string };

/** Both dialogs of the Explorer, so the panel has one thing to mount. */
export function ExplorerDialogs({
  naming,
  moving,
  directories,
  pending,
  onName,
  onMove,
  onCancel,
}: {
  naming: NameRequest | null;
  moving: string | null;
  directories: readonly string[];
  pending: boolean;
  onName: (request: NameRequest, name: string) => void;
  onMove: (path: string, to: string) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <NameDialog request={naming} pending={pending} onSubmit={onName} onCancel={onCancel} />
      <MoveDialog
        path={moving}
        directories={directories}
        pending={pending}
        onSubmit={onMove}
        onCancel={onCancel}
      />
    </>
  );
}

/** Asks for a name: of a new file or folder, or the new name of an old one. */
function NameDialog({
  request,
  pending,
  onSubmit,
  onCancel,
}: {
  request: NameRequest | null;
  pending: boolean;
  onSubmit: (request: NameRequest, name: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={request !== null}
      title={
        request?.kind === "rename"
          ? "Rename"
          : request?.type === "directory"
            ? "New folder"
            : "New file"
      }
      description={
        request?.kind === "rename"
          ? `A new name for ${request.path}. A tracked file keeps its history.`
          : request
            ? `Made in ${request.dir === "." ? "the project root" : request.dir}.`
            : undefined
      }
      onCancel={() => {
        if (!pending) onCancel();
      }}
    >
      {request ? (
        <NameForm request={request} pending={pending} onSubmit={onSubmit} onCancel={onCancel} />
      ) : null}
    </Dialog>
  );
}

function NameForm({
  request,
  pending,
  onSubmit,
  onCancel,
}: {
  request: NameRequest;
  pending: boolean;
  onSubmit: (request: NameRequest, name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(request.kind === "rename" ? baseName(request.path) : "");
  const problem = name ? validName(name) : null;
  const unchanged = request.kind === "rename" && name.trim() === baseName(request.path);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (problem || unchanged || !name.trim()) return;
        onSubmit(request, name.trim());
      }}
    >
      <Field
        label="Name"
        value={name}
        onChange={setName}
        placeholder={
          request.kind === "create" && request.type === "directory" ? "folder" : "file.txt"
        }
        disabled={pending}
        autoFocus
        hint={problem}
      />
      <DialogActions>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !name.trim() || problem !== null || unchanged}
        >
          {request.kind === "rename" ? "Rename" : "Create"}
        </button>
      </DialogActions>
    </form>
  );
}

/** Where a file or folder goes: any folder the Explorer knows, or one typed in. */
function MoveDialog({
  path,
  directories,
  pending,
  onSubmit,
  onCancel,
}: {
  path: string | null;
  /** Every directory listed so far, the root as ".". */
  directories: readonly string[];
  pending: boolean;
  onSubmit: (path: string, to: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={path !== null}
      title="Move to…"
      description={path ? `${path} keeps its name in the folder chosen here.` : undefined}
      onCancel={() => {
        if (!pending) onCancel();
      }}
    >
      {path ? (
        <MoveForm
          path={path}
          directories={directories}
          pending={pending}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      ) : null}
    </Dialog>
  );
}

function MoveForm({
  path,
  directories,
  pending,
  onSubmit,
  onCancel,
}: {
  path: string;
  directories: readonly string[];
  pending: boolean;
  onSubmit: (path: string, to: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(".");
  const [typed, setTyped] = useState("");
  const target = typed.trim() || to;
  const inside = target === path || target.startsWith(`${path}/`);
  const options = directories
    .filter((dir) => dir !== path && !dir.startsWith(`${path}/`))
    .map((dir) => ({ value: dir, label: dir === "." ? "Project root" : dir }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (inside || !target) return;
        onSubmit(path, target);
      }}
    >
      <div className="mt-3">
        <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
          Folder
        </span>
        <div className="mt-2">
          <Select
            label="Folder"
            value={to}
            options={options}
            onChange={setTo}
            wide
            disabled={pending}
          />
        </div>
      </div>
      <Field
        label="Or a path"
        value={typed}
        onChange={setTyped}
        placeholder="src/lib"
        disabled={pending}
        hint={
          inside
            ? "A folder cannot be moved into itself."
            : "Relative to the project root. Made if it is not there."
        }
      />
      <DialogActions>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || inside || !target}>
          Move to {target === "." ? "the root" : joinPath(target, baseName(path))}
        </button>
      </DialogActions>
    </form>
  );
}

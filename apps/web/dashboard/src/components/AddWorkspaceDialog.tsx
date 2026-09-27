import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText, type Project, type User } from "../api.js";
import {
  type CreateWorkspaceInput,
  type CreateWorkspaceResult,
  createdSlug,
  projectsApi,
} from "../api-projects.js";
import { noPlacement, placement } from "../placement.js";
import { cloudLocation, defaultBranchOf, slugFromName } from "../projectModel.js";
import { keys, refreshPlaces } from "../queries.js";
import {
  Advanced,
  Dialog,
  DialogActions,
  DialogError,
  DialogProgress,
  Field,
  fieldLabelClass,
} from "./Dialog.js";
import { Select, type SelectOption } from "./Select.js";
import { useToast } from "./toast.js";

/** The `where` that puts a project on Exeora Cloud on the way to its first workspace there. */
const NEW_CLOUD = "cloud";

/**
 * A new workspace, in whichever location.
 *
 * One dialog for every place a project lives. It asks for the branch and
 * where, says what that will do, and stays open until the gateway has
 * answered, because the first workspace on a machine clones the repository
 * and that is minutes, not a moment. A refusal is shown here, next to the
 * fields that caused it.
 */
export function AddWorkspaceDialog({
  open,
  project,
  user,
  initialBranch = "",
  initialFrom = "",
  initialWhere,
  onAddLocation,
  onCancel,
  onCreated,
}: {
  open: boolean;
  project: Project | undefined;
  user: User | undefined;
  initialBranch?: string;
  initialFrom?: string;
  /** The slug of the location to start on. The default location when left out. */
  initialWhere?: string;
  /**
   * Opens the dialog that adds a location, for a project that has none to
   * choose from. Left out where the page has no such dialog to open.
   */
  onAddLocation?: () => void;
  onCancel: () => void;
  onCreated: (result: CreateWorkspaceResult) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Held out here and not in the form, so that Escape can be refused while
  // the request is open: the dialog is what says a clone is still running.
  const create = useMutation({
    mutationFn: (entry: { projectId: string; where: string; input: CreateWorkspaceInput }) =>
      projectsApi.createWorkspace(entry.projectId, entry.input),
    onSuccess: (result, entry) => {
      toast(
        result.status === "creating"
          ? `Setting up an instance for ${entry.input.branch}. It is listed with its state until it is ready.`
          : `${entry.input.branch} is ready on ${entry.where}, as ${createdSlug(result)}.`,
      );
      void refreshPlaces(queryClient, entry.projectId);
      void queryClient.invalidateQueries({ queryKey: keys.allCalls });
      create.reset();
      onCreated(result);
    },
  });

  const cancel = () => {
    if (create.isPending) return;
    create.reset();
    onCancel();
  };

  return (
    <Dialog
      open={open && project !== undefined}
      title="Add a workspace"
      description="A branch with a working copy of its own, so work on it does not disturb any other."
      onCancel={cancel}
    >
      {project ? (
        <Form
          project={project}
          user={user}
          initialBranch={initialBranch}
          initialFrom={initialFrom}
          initialWhere={initialWhere}
          pending={create.isPending}
          error={
            create.isError ? errorText(create.error, "The workspace could not be created.") : null
          }
          onCancel={cancel}
          onAddLocation={
            onAddLocation
              ? () => {
                  cancel();
                  onAddLocation();
                }
              : undefined
          }
          onSubmit={(where, input) => create.mutate({ projectId: project.id, where, input })}
        />
      ) : null}
    </Dialog>
  );
}

function Form({
  project,
  user,
  initialBranch,
  initialFrom,
  initialWhere,
  pending,
  error,
  onCancel,
  onAddLocation,
  onSubmit,
}: {
  project: Project;
  user: User | undefined;
  initialBranch: string;
  initialFrom: string;
  initialWhere: string | undefined;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onAddLocation: (() => void) | undefined;
  /** The name of the location, for the sentence that follows, and what to send. */
  onSubmit: (where: string, input: CreateWorkspaceInput) => void;
}) {
  const locations = project.locations.filter((location) => location.state !== "removed");
  const offerCloud =
    cloudLocation(project) === null && user?.cloudEnabled === true && project.repoUrl !== null;

  const [branch, setBranch] = useState(initialBranch);
  const [from, setFrom] = useState(initialFrom);
  const [where, setWhere] = useState(
    () =>
      locations.find((location) => location.slug === initialWhere)?.slug ??
      locations.find((location) => location.default)?.slug ??
      locations[0]?.slug ??
      (offerCloud ? NEW_CLOUD : ""),
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [reuse, setReuse] = useState(false);

  const chosen = locations.find((location) => location.slug === where) ?? null;
  const plan = where === "" ? noPlacement(project) : placement(chosen, user);
  const onMachine = chosen?.kind === "local";
  const defaultBranch = defaultBranchOf(project);

  const options: SelectOption[] = [
    ...locations.map((location) => ({
      value: location.slug,
      label: location.name,
      hint: location.default ? `${location.state} · default location` : location.state,
    })),
    ...(offerCloud ? [{ value: NEW_CLOUD, label: "Exeora Cloud (adds the project there)" }] : []),
  ];

  const target = branch.trim();
  const same = target.length > 0 && target === from.trim() && !reuse;
  const ready = !pending && target.length > 0 && where !== "" && !plan.blocked && !same;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSubmit(chosen?.name ?? "Exeora Cloud", {
          branch: target,
          where,
          ...(from.trim() && !(onMachine && reuse) ? { from: from.trim() } : {}),
          ...(onMachine && reuse ? { reuseExistingBranch: true } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(slugFromName(slug) ? { slug: slugFromName(slug) } : {}),
        });
      }}
    >
      <Field
        label="Branch"
        value={branch}
        onChange={setBranch}
        disabled={pending}
        placeholder="feature/name"
        autoFocus
        className="mt-4"
      />
      <Field
        label="Start from"
        value={from}
        onChange={setFrom}
        disabled={pending || (onMachine && reuse)}
        placeholder={defaultBranch ?? "the default branch"}
        hint="Only used when the branch does not exist yet."
      />
      {same ? (
        <p className="text-body-md text-foreground-muted mt-2">
          {target} cannot start from itself. Use a new branch name, or reuse the existing branch
          under Advanced.
        </p>
      ) : null}

      <div className="mt-3">
        <span className={fieldLabelClass}>Where</span>
        <div className="mt-2">
          <Select
            label="Where"
            value={where}
            options={options}
            disabled={pending}
            placeholder="Choose a location"
            onChange={setWhere}
            wide
          />
        </div>
        <p className="text-body-md text-foreground-muted mt-2">{plan.sentence}</p>
        {/* With no location to choose, the way to one of the person's own
            machines is a location added first. */}
        {locations.length === 0 && onAddLocation ? (
          <p className="text-body-md text-foreground-muted mt-2">
            {where === "" ? null : "To use one of your machines instead, add it as a location. "}
            <button type="button" className="underline" disabled={pending} onClick={onAddLocation}>
              Add location
            </button>
          </p>
        ) : null}
      </div>

      <Advanced>
        <Field
          label="Name"
          value={name}
          onChange={setName}
          disabled={pending}
          placeholder={target || "the branch"}
        />
        <Field
          label="Slug"
          value={slug}
          onChange={setSlug}
          disabled={pending}
          placeholder={slugFromName(target) || "from the branch"}
          hint="What a client names to reach this workspace. The gateway adds the location to it when another location already has the same one."
        />
        {onMachine ? (
          <label className="text-body-md mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              checked={reuse}
              disabled={pending}
              onChange={(event) => setReuse(event.target.checked)}
              className="accent-foreground mt-1"
            />
            <span>Use an existing local branch instead of creating {target || "this branch"}.</span>
          </label>
        ) : null}
      </Advanced>

      {pending ? <DialogProgress>{plan.progress}</DialogProgress> : null}
      <DialogError>{error}</DialogError>

      <DialogActions>
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {pending ? "Working…" : "Add workspace"}
        </button>
      </DialogActions>
    </form>
  );
}

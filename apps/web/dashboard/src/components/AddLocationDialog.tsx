import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { errorText, type Project, type User } from "../api.js";
import { type AddLocationInput, type Machine, projectsApi } from "../api-projects.js";
import { CLOUD, type LocationCandidate, locationCandidates } from "../placement.js";
import { refreshPlaces } from "../queries.js";
import { Dialog, DialogActions, DialogError, Field } from "./Dialog.js";
import { StateBadge } from "./StateBadge.js";
import { useToast } from "./toast.js";

/**
 * One more place for a project to live.
 *
 * Adding a machine clones nothing: it says the project may live there, and the
 * first workspace made there is what brings the copy. The dialog says so,
 * because "Add location" followed by nothing visibly happening on the machine
 * would otherwise look like a failure.
 */
export function AddLocationDialog({
  open,
  project,
  machines,
  user,
  onClose,
}: {
  open: boolean;
  project: Project | undefined;
  machines: readonly Machine[];
  user: User | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const add = useMutation({
    mutationFn: (entry: { projectId: string; name: string; input: AddLocationInput }) =>
      projectsApi.addLocation(entry.projectId, entry.input),
    onSuccess: (_result, entry) => {
      toast(
        "kind" in entry.input
          ? "The project is on Exeora Cloud. Add a workspace there to start an instance."
          : `${entry.name} is a location now. The first workspace made there clones the repository.`,
      );
      void refreshPlaces(queryClient, entry.projectId);
      add.reset();
      onClose();
    },
  });

  const cancel = () => {
    if (add.isPending) return;
    add.reset();
    onClose();
  };

  return (
    <Dialog
      open={open && project !== undefined}
      title="Add a location"
      description="Another place this project has a copy: one of your machines, or Exeora Cloud."
      onCancel={cancel}
    >
      {project ? (
        <Form
          project={project}
          candidates={locationCandidates(project, machines, user)}
          pending={add.isPending}
          error={add.isError ? errorText(add.error, "The location could not be added.") : null}
          onCancel={cancel}
          onSubmit={(name, input) => add.mutate({ projectId: project.id, name, input })}
        />
      ) : null}
    </Dialog>
  );
}

function Form({
  project,
  candidates,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  project: Project;
  candidates: LocationCandidate[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (name: string, input: AddLocationInput) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const chosen = candidates.find((candidate) => candidate.value === picked && !candidate.blocked);

  let body: ReactNode;
  if (project.repoUrl === null) {
    body = (
      <p className="text-body-md text-foreground-muted mt-4">
        This project has no repository, so there is nothing another location could clone. Give it a
        remote on the machine that holds it, then run <code className="font-mono">exeora sync</code>{" "}
        there.
      </p>
    );
  } else if (candidates.length === 0) {
    body = (
      <p className="text-body-md text-foreground-muted mt-4">
        This project is already in every place it could be. To add a machine, install the CLI on it
        and run <code className="font-mono">exeora connect</code>.
      </p>
    );
  } else {
    body = (
      <fieldset className="border-border mt-4 rounded-lg border p-1" disabled={pending}>
        <legend className="text-label-md text-foreground-faint px-2">Where</legend>
        {candidates.map((candidate) => (
          <label
            key={candidate.value}
            className={`flex items-start gap-3 rounded-md px-3 py-2 ${
              candidate.blocked ? "opacity-60" : "hover:bg-accent-subtle cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="location"
              className="accent-foreground mt-1"
              checked={picked === candidate.value}
              disabled={candidate.blocked !== null}
              onChange={() => setPicked(candidate.value)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-body-md text-foreground truncate">{candidate.name}</span>
                {candidate.state ? <StateBadge state={candidate.state} /> : null}
              </span>
              {candidate.blocked ? (
                <span className="text-body-md text-foreground-muted mt-0.5 block">
                  {candidate.blocked}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!chosen || pending) return;
        onSubmit(
          chosen.name,
          chosen.value === CLOUD
            ? {
                kind: "cloud",
                ...(token ? { token } : {}),
                ...(token && username.trim() ? { username: username.trim() } : {}),
              }
            : { deviceId: chosen.value },
        );
      }}
    >
      {body}

      {chosen && chosen.value !== CLOUD ? (
        <p className="text-body-md text-foreground-muted mt-3">
          Nothing is cloned now. The first workspace made on {chosen.name} clones the repository
          into that machine's projects folder.
        </p>
      ) : null}

      {chosen?.value === CLOUD ? (
        project.github ? (
          <p className="text-body-md text-foreground-muted mt-3">
            Exeora Cloud clones {project.github.fullName} through GitHub. No instance starts until a
            workspace is added there.
          </p>
        ) : (
          <>
            <p className="text-body-md text-foreground-muted mt-3">
              No instance starts until a workspace is added there. A private repository needs a
              token that can read it, and write to it to push.
            </p>
            <Field
              label="Access token"
              type="password"
              value={token}
              onChange={setToken}
              disabled={pending}
              placeholder="Optional, for a private repository"
            />
            <Field
              label="Token username"
              value={username}
              onChange={setUsername}
              disabled={pending || token.length === 0}
              placeholder="x-access-token"
            />
          </>
        )
      ) : null}

      <DialogError>{error}</DialogError>

      <DialogActions>
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          {project.repoUrl === null || candidates.length === 0 ? "Close" : "Cancel"}
        </button>
        {project.repoUrl !== null && candidates.length > 0 ? (
          <button type="submit" className="btn btn-primary" disabled={!chosen || pending}>
            {pending ? "Working…" : "Add location"}
          </button>
        ) : null}
      </DialogActions>
    </form>
  );
}

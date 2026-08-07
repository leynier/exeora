import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AccountClient, api, type Project, relativeTime } from "../api.js";
import { clientLabel, clientVersion } from "../format.js";
import { keys } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Select } from "./Select.js";
import { useToast } from "./toast.js";
import { Badge, Divided } from "./ui.js";

/**
 * The clients connected through the account URL, one row each.
 *
 * A separate list from `ClientList` because it answers a different question.
 * There, a row is one client on one project and the only decision is whether to
 * keep it. Here a row is one connection covering several projects, and the
 * decisions are which projects it reaches and which of them it is working in,
 * neither of which fits a list that shows a project per row.
 *
 * Removing the last project is how a connection is shut off, and it says so:
 * there is no separate revoke, because taking every project away is exactly
 * what revoking this kind of client means.
 */
export function AccountClientList({
  clients,
  projects,
}: {
  clients: AccountClient[];
  projects: Project[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Awaited, not fired off: every submission is the whole access list computed
  // from what the server last said, so the mutation has to stay pending until
  // the refetch lands. Without that the boxes are enabled again while `granted`
  // is still the pre-mutation list, and a second tick sends a list missing the
  // project the first one just added.
  const settle = (message: string) => {
    toast(message);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.accountClients }),
      queryClient.invalidateQueries({ queryKey: keys.clients }),
    ]);
  };

  const fail = (error: unknown, fallback: string) =>
    toast(error instanceof Error ? error.message : fallback, "error");

  const setProjects = useMutation({
    mutationFn: ({ clientId, projectIds }: { clientId: string; projectIds: string[] }) =>
      api.setAccountClientProjects(clientId, projectIds),
    onSuccess: () => settle("Access updated."),
    onError: (error) => fail(error, "Could not update access."),
  });

  const setActive = useMutation({
    mutationFn: ({ clientId, projectId }: { clientId: string; projectId: string | null }) =>
      api.setAccountClientActiveProject(clientId, projectId),
    onSuccess: () => settle("Active project updated."),
    onError: (error) => fail(error, "Could not change the active project."),
  });

  const busy = setProjects.isPending || setActive.isPending;

  return (
    <Divided>
      {clients.map((client) => (
        <AccountClientRow
          key={client.clientId}
          client={client}
          projects={projects}
          busy={busy}
          onSetProjects={(projectIds) =>
            setProjects.mutate({ clientId: client.clientId, projectIds })
          }
          onSetActive={(projectId) => setActive.mutate({ clientId: client.clientId, projectId })}
        />
      ))}
    </Divided>
  );
}

function AccountClientRow({
  client,
  projects,
  busy,
  onSetProjects,
  onSetActive,
}: {
  client: AccountClient;
  projects: Project[];
  busy: boolean;
  onSetProjects: (projectIds: string[]) => void;
  onSetActive: (projectId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  // Unticking the last project is not one more edit: it drops the OAuth grant,
  // so the client has to be authorized again from its own settings before it
  // works. Every other tick is reversible from here, which is exactly why this
  // one needs asking about rather than a sentence somebody reads afterwards.
  const [confirmingCutOff, setConfirmingCutOff] = useState(false);

  const granted = client.projects
    .filter((entry) => entry.revokedAt === null)
    .map((entry) => entry.projectId);

  const grantedSet = new Set(granted);
  const version = clientVersion(client);
  const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? "removed";

  // The pointer can name a project the client no longer reaches, since revoking
  // access does not go looking for it. Falling back to "none" here matches what
  // a tool call would do with it, which is ignore it.
  const active =
    client.activeProjectId && grantedSet.has(client.activeProjectId) ? client.activeProjectId : "";

  return (
    // Not `Row`, which centres a single line: this one stacks a header, the
    // access list and the pointer, and each wants the full width.
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-title-md truncate">{clientLabel(client)}</p>
            {granted.length === 0 && <Badge tone="error">no access</Badge>}
          </div>
          <p className="text-body-md text-foreground-faint truncate">
            {version ? `${version} · ` : ""}
            {client.lastUsedAt ? `last used ${relativeTime(client.lastUsedAt)}` : "never used"} ·
            authorized {relativeTime(client.authorizedAt)}
          </p>
        </div>

        <button
          type="button"
          className="btn shrink-0"
          disabled={busy}
          onClick={() => setEditing((open) => !open)}
        >
          {editing ? "Done" : "Edit access"}
        </button>
      </div>

      {editing ? (
        <fieldset className="border-border rounded-lg border p-1" disabled={busy}>
          <legend className="text-label-md text-foreground-faint px-2">Projects it reaches</legend>
          {projects.length === 0 ? (
            <p className="text-body-md text-foreground-faint px-3 py-2">
              You have no projects to give it.
            </p>
          ) : (
            projects.map((project) => (
              <label
                key={project.id}
                className="hover:bg-accent-subtle flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="accent-foreground"
                  checked={grantedSet.has(project.id)}
                  onChange={(event) => {
                    if (event.target.checked) {
                      onSetProjects([...granted, project.id]);
                      return;
                    }

                    const left = granted.filter((id) => id !== project.id);
                    if (left.length === 0) setConfirmingCutOff(true);
                    else onSetProjects(left);
                  }}
                />
                <span className="text-body-md min-w-0 truncate">{project.name}</span>
              </label>
            ))
          )}
        </fieldset>
      ) : (
        <p className="text-body-md text-foreground-muted">
          {granted.length === 0
            ? "It cannot reach any project, and its token went with the last one. Giving it a project back here is not enough: it has to be authorized again from the client."
            : granted.map(nameOf).join(", ")}
        </p>
      )}

      {granted.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-body-md text-foreground-faint">Working in</span>
          <Select
            label={`Active project for ${clientLabel(client)}`}
            value={active}
            options={[
              // Empty means the client has not chosen. With one project granted
              // that reads the same as choosing it, because a call resolves to
              // the only one there is.
              { value: "", label: granted.length === 1 ? "the only project" : "not chosen" },
              ...granted.map((id) => ({ value: id, label: nameOf(id) })),
            ]}
            onChange={(value) => onSetActive(value === "" ? null : value)}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmingCutOff}
        title={`Cut ${clientLabel(client)} off?`}
        body="This was its last project. Its token stops working, and giving it a project back here will not revive it: it has to be authorized again from the client."
        confirmLabel="Cut it off"
        pending={busy}
        onCancel={() => setConfirmingCutOff(false)}
        onConfirm={() => {
          setConfirmingCutOff(false);
          onSetProjects([]);
        }}
      />
    </div>
  );
}

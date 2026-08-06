import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Client, relativeTime } from "../api.js";
import { clientLabel, clientVersion } from "../format.js";
import { keys } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";
import { Badge, Divided, EmptyState, Row } from "./ui.js";

/**
 * The clients authorized against a project, and the two ways to get rid of one.
 *
 * Shared by the Clients tab and the project page rather than written twice: the
 * rows are the same rows and, more to the point, so are the consequences of the
 * buttons on them.
 *
 * Revoking is the urgent action and reversible, since authorizing the client
 * again restores it. Deleting is only offered afterwards, because it also takes
 * this project's history of that client's calls and unregisters the application
 * itself.
 */
type Pending = { client: Client; action: "revoke" | "delete" } | null;

export function ClientList({
  clients,
  projectNameOf,
}: {
  clients: Client[];
  /** Given when the list spans projects, so each row can say which one. */
  projectNameOf?: (projectId: string) => string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const settle = (message: string) => {
    toast(message);
    setPending(null);
    queryClient.invalidateQueries({ queryKey: keys.clients });
    queryClient.invalidateQueries({ queryKey: keys.calls });
  };

  const fail = (error: unknown, fallback: string) => {
    toast(error instanceof Error ? error.message : fallback, "error");
    setPending(null);
  };

  const nameOf = (id: string) =>
    clients.find((client) => client.id === id)?.clientName ?? "The client";

  const revoke = useMutation({
    mutationFn: api.revokeClient,
    onSuccess: (_result, id) => settle(`${nameOf(id)} can no longer reach this project.`),
    onError: (error) => fail(error, "Could not revoke."),
  });

  const remove = useMutation({
    mutationFn: api.deleteClient,
    onSuccess: (_result, id) => settle(`${nameOf(id)} was deleted.`),
    onError: (error) => fail(error, "Could not delete."),
  });

  const busy = revoke.isPending || remove.isPending;

  if (clients.length === 0) {
    return (
      <EmptyState title="No clients yet">
        An AI client appears here the first time you authorize it against this endpoint.
      </EmptyState>
    );
  }

  return (
    <>
      <Divided>
        {clients.map((client) => {
          const version = clientVersion(client);

          return (
            <Row key={client.id}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-title-md truncate">{clientLabel(client)}</p>
                  {client.revokedAt && <Badge tone="error">revoked</Badge>}
                </div>
                <p className="text-body-md text-foreground-faint truncate">
                  {projectNameOf ? `${projectNameOf(client.projectId)} · ` : ""}
                  {version ? `${version} · ` : ""}
                  {client.revokedAt
                    ? `revoked ${relativeTime(client.revokedAt)}`
                    : client.lastUsedAt
                      ? `last used ${relativeTime(client.lastUsedAt)}`
                      : "never used"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                <span className="text-body-md text-foreground-faint hidden sm:block">
                  authorized {relativeTime(client.authorizedAt)}
                </span>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() =>
                    setPending({ client, action: client.revokedAt ? "delete" : "revoke" })
                  }
                >
                  {client.revokedAt ? "Delete" : "Revoke"}
                </button>
              </div>
            </Row>
          );
        })}
      </Divided>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === "delete"
            ? `Delete ${clientLabel(pending.client)}?`
            : `Revoke ${pending ? clientLabel(pending.client) : ""}?`
        }
        body={
          pending?.action === "delete"
            ? "Its calls on this project are removed from the activity log, and the application is unregistered. This cannot be undone."
            : "Its access token stops working immediately and the next tool call it makes is refused. Authorizing it again from the client restores access."
        }
        confirmLabel={pending?.action === "delete" ? "Delete permanently" : "Revoke"}
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.action === "delete") remove.mutate(pending.client.id);
          else revoke.mutate(pending.client.id);
        }}
      />
    </>
  );
}

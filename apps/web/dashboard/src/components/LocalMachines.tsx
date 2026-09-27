import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, errorText, type Project, relativeTime } from "../api.js";
import type { LocalMachine } from "../api-projects.js";
import { formatDate } from "../format.js";
import { keys, refreshPlaces } from "../queries.js";
import { deletionImpact } from "../survival.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { MachineRow } from "./MachineRow.js";
import { useToast } from "./toast.js";
import { Badge, Card, Divided, EmptyState, SkeletonRows } from "./ui.js";

/**
 * Revoking is the urgent action: one click, reversible by registering again.
 * Deleting is only offered afterwards, because it also takes the projects
 * that live nowhere else, and there is no undo.
 */
type Pending = { machine: LocalMachine; action: "revoke" | "delete" } | null;

/** The person's own machines, with what each of them holds. */
export function LocalMachines({
  machines,
  projects,
  loading,
}: {
  machines: readonly LocalMachine[];
  projects: readonly Project[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const settle = (message: string) => {
    toast(message);
    setPending(null);
    void refreshPlaces(queryClient);
    void queryClient.invalidateQueries({ queryKey: keys.allCalls });
  };
  const fail = (error: unknown, fallback: string) => {
    toast(errorText(error, fallback), "error");
    setPending(null);
  };

  const revoke = useMutation({
    mutationFn: (machine: LocalMachine) => api.revokeDevice(machine.deviceId),
    onSuccess: (_result, machine) => settle(`${machine.name} was revoked.`),
    onError: (error) => fail(error, "The machine could not be revoked."),
  });

  // A refusal stays in the dialog. The one the gateway gives when a project
  // cannot be moved to Exeora Cloud names the project and the two ways out,
  // and nothing was deleted, so there is something to read and act on.
  const remove = useMutation({
    mutationFn: (machine: LocalMachine) => api.deleteDevice(machine.deviceId),
    onSuccess: (_result, machine) => settle(`${machine.name} was deleted.`),
  });

  const dismiss = () => {
    remove.reset();
    setPending(null);
  };

  const busy = revoke.isPending || remove.isPending;
  const impact = pending?.action === "delete" ? deletionImpact(pending.machine, projects) : null;

  return (
    <>
      <Card>
        {loading ? (
          <SkeletonRows />
        ) : machines.length === 0 ? (
          <EmptyState title="No machines of your own yet">
            Install the CLI on the machine that holds your code, then run{" "}
            <code className="font-mono">exeora connect</code> there. The{" "}
            <Link to="/projects" className="underline">
              Projects
            </Link>{" "}
            page has the commands, under "See how to use my machine".
          </EmptyState>
        ) : (
          <Divided>
            {machines.map((machine) => (
              <MachineRow
                key={machine.deviceId}
                state={machine.state}
                title={machine.name}
                meta={
                  <>
                    {machine.platform}
                    {machine.cliVersion ? ` · CLI ${machine.cliVersion}` : ""} ·{" "}
                    {machine.revokedAt
                      ? `revoked ${relativeTime(machine.revokedAt)}`
                      : machine.state === "online"
                        ? "connected now"
                        : `last seen ${relativeTime(machine.lastSeenAt)}`}
                  </>
                }
                menuLabel={`Actions for ${machine.name}`}
                busy={busy}
                actions={
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      setPending({ machine, action: machine.revokedAt ? "delete" : "revoke" })
                    }
                  >
                    {machine.revokedAt ? "Delete" : "Revoke"}
                  </button>
                }
                detailsLabel={`${machine.projects.length} ${machine.projects.length === 1 ? "project" : "projects"} · added ${formatDate(machine.createdAt)}`}
                details={
                  machine.projects.length === 0 ? (
                    <p className="text-body-md text-foreground-faint">
                      No project lives on this machine.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {machine.projects.map((held) => (
                        <li key={held.projectId} className="text-body-md">
                          <span className="flex flex-wrap items-center gap-2">
                            <Link
                              to={`/projects/${held.projectId}`}
                              className="text-foreground underline-offset-2 hover:underline"
                            >
                              {held.name}
                            </Link>
                            {held.default && <Badge tone="brand">default location</Badge>}
                            <span className="text-foreground-faint tabular-nums">
                              {held.workspaces} {held.workspaces === 1 ? "workspace" : "workspaces"}
                            </span>
                          </span>
                          <code className="text-foreground-faint font-mono break-all">
                            {held.localPath ?? "not cloned yet"}
                          </code>
                        </li>
                      ))}
                    </ul>
                  )
                }
              />
            ))}
          </Divided>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === "delete"
            ? `Delete ${pending.machine.name}?`
            : `Revoke ${pending?.machine.name ?? ""}?`
        }
        body={
          pending?.action === "delete"
            ? "This cannot be undone. Registering the machine again later creates a new one rather than restoring this. The files on the machine are untouched."
            : "Its connection is closed at once and it stops answering calls. Whatever lives only on this machine is out of reach until a machine is registered again."
        }
        details={
          impact ? (
            <div className="text-body-md text-foreground-muted mt-3 space-y-3">
              <ImpactList
                title="Deleted with it, along with their activity history:"
                none="No project is deleted: none lives only on this machine."
                names={impact.deleted.map((held) => held.name)}
              />
              <ImpactList
                title="These survive, in their other locations:"
                none={null}
                names={impact.surviving.map((held) => held.name)}
              />
              <ImpactList
                title="These move to Exeora Cloud, which starts an instance for their project root:"
                none={null}
                names={impact.moving.map((held) => held.name)}
              />
              {impact.moving.length > 0 ? (
                <p>
                  Each of those instances counts against the limit of the plan. If one cannot be
                  started, nothing is deleted.
                </p>
              ) : null}
            </div>
          ) : null
        }
        error={
          pending?.action === "delete" && remove.isError
            ? errorText(remove.error, "The machine could not be deleted.")
            : null
        }
        confirmLabel={pending?.action === "delete" ? "Delete permanently" : "Revoke"}
        pending={busy}
        onCancel={dismiss}
        onConfirm={() => {
          if (!pending) return;
          if (pending.action === "delete") remove.mutate(pending.machine);
          else revoke.mutate(pending.machine);
        }}
      />
    </>
  );
}

function ImpactList({
  title,
  none,
  names,
}: {
  title: string;
  /** What to say when the list is empty, or null to say nothing. */
  none: string | null;
  names: string[];
}) {
  if (names.length === 0) return none ? <p>{none}</p> : null;
  return (
    <div>
      <p>{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {names.map((name) => (
          <li key={name} className="text-foreground">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Device, isOnline, relativeTime } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useToast } from "../components/toast.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  PageHeader,
  Row,
  SkeletonRows,
  StatusDot,
} from "../components/ui.js";
import { formatDate } from "../format.js";
import { keys, useDevices, useProjects } from "../queries.js";

/**
 * Machines, and the two ways to get rid of one.
 *
 * Revoking is the urgent action: one click, reversible by registering again.
 * Deleting is only offered afterwards, because it also takes the machine's
 * projects and their audit history, and there is no undo.
 */
type Pending = { device: Device; action: "revoke" | "delete" } | null;

export function Machines() {
  const devices = useDevices();
  const projects = useProjects();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const machines = devices.data ?? [];
  const nameOf = (id: string) => machines.find((device) => device.id === id)?.name ?? "The machine";
  const projectCount = (id: string) =>
    (projects.data ?? []).filter((project) => project.deviceId === id).length;

  const settle = (message: string, invalidateProjects = false) => {
    toast(message);
    setPending(null);
    queryClient.invalidateQueries({ queryKey: keys.devices });
    queryClient.invalidateQueries({ queryKey: keys.allCalls });
    if (invalidateProjects) queryClient.invalidateQueries({ queryKey: keys.projects });
  };

  const fail = (error: unknown, fallback: string) => {
    toast(error instanceof Error ? error.message : fallback, "error");
    setPending(null);
  };

  const revoke = useMutation({
    mutationFn: api.revokeDevice,
    onSuccess: (_result, id) => settle(`${nameOf(id)} was revoked.`),
    onError: (error) => fail(error, "Could not revoke."),
  });

  const remove = useMutation({
    mutationFn: api.deleteDevice,
    // Projects too: they cascade from the machine, so the other pages are
    // stale the moment this succeeds.
    onSuccess: (_result, id) => settle(`${nameOf(id)} was deleted.`, true),
    onError: (error) => fail(error, "Could not delete."),
  });

  const busy = revoke.isPending || remove.isPending;

  return (
    <>
      <PageHeader
        title="Machines"
        subtitle="Registered from the CLI, and revocable from here the moment you want one to stop."
      />

      <Card>
        {devices.isLoading ? (
          <SkeletonRows />
        ) : machines.length === 0 ? (
          <EmptyState title="No machines yet">
            Run <code className="font-mono">npx @exeora/cli connect</code> in a project directory.
          </EmptyState>
        ) : (
          <Divided>
            {machines.map((device) => (
              <Row key={device.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <StatusDot
                    on={isOnline(device)}
                    label={isOnline(device) ? "online" : "offline"}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-title-md truncate">{device.name}</p>
                      {device.revokedAt && <Badge tone="error">revoked</Badge>}
                    </div>
                    <p className="text-body-md text-foreground-faint truncate">
                      {device.platform}
                      {device.cliVersion ? ` · CLI ${device.cliVersion}` : ""} ·{" "}
                      {device.revokedAt
                        ? `revoked ${relativeTime(device.revokedAt)}`
                        : isOnline(device)
                          ? "online"
                          : `last seen ${relativeTime(device.lastSeenAt)}`}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-body-md text-foreground-faint hidden sm:block">
                    added {formatDate(device.createdAt)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      setPending({ device, action: device.revokedAt ? "delete" : "revoke" })
                    }
                  >
                    {device.revokedAt ? "Delete" : "Revoke"}
                  </button>
                </div>
              </Row>
            ))}
          </Divided>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === "delete"
            ? `Delete ${pending.device.name}?`
            : `Revoke ${pending?.device.name ?? ""}?`
        }
        body={
          pending?.action === "delete"
            ? deleteWarning(projectCount(pending.device.id))
            : "Its connection is closed immediately and it stops serving tool calls. Projects on that machine become unreachable until you register it again."
        }
        confirmLabel={pending?.action === "delete" ? "Delete permanently" : "Revoke"}
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.action === "delete") remove.mutate(pending.device.id);
          else revoke.mutate(pending.device.id);
        }}
      />
    </>
  );
}

/** Names what goes with the machine, because none of it comes back. */
function deleteWarning(projects: number): string {
  const belongings =
    projects === 0
      ? "It has no projects left"
      : `Its ${projects} ${projects === 1 ? "project is" : "projects are"} deleted with it, along with their activity history`;

  return `${belongings}. This cannot be undone. Registering the machine again later creates a new one rather than restoring this.`;
}

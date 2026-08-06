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
import { keys, useDevices } from "../queries.js";

export function Machines() {
  const devices = useDevices();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingRevoke, setPendingRevoke] = useState<Device | null>(null);

  const revoke = useMutation({
    mutationFn: api.revokeDevice,
    onSuccess: (_result, id) => {
      const name = devices.data?.find((device) => device.id === id)?.name ?? "The machine";
      toast(`${name} was revoked.`);
      setPendingRevoke(null);
      // Devices for the row, calls because the relay stops serving that
      // machine. Nothing else changes, so nothing else is refetched.
      queryClient.invalidateQueries({ queryKey: keys.devices });
      queryClient.invalidateQueries({ queryKey: keys.calls });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not revoke.", "error");
      setPendingRevoke(null);
    },
  });

  const machines = devices.data ?? [];

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
            Install the CLI and run <code className="font-mono">exeora device register</code>.
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
                  {!device.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setPendingRevoke(device)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </Row>
            ))}
          </Divided>
        )}
      </Card>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={`Revoke ${pendingRevoke?.name ?? ""}?`}
        body="Its connection is closed immediately and it stops serving tool calls. Projects on that machine become unreachable until you register it again."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => pendingRevoke && revoke.mutate(pendingRevoke.id)}
      />
    </>
  );
}

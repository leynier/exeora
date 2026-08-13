import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Client, type Device, isOnline, relativeTime } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useToast } from "../components/toast.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Row,
  SkeletonRows,
  Stat,
  StatusDot,
} from "../components/ui.js";
import { clientLabel, formatDate, formatDuration, shortenPath } from "../format.js";
import { keys, useAdminUser } from "../queries.js";

/**
 * One account, seen by an administrator.
 *
 * Destructive actions refuse the caller's own account on the server; the UI
 * still offers them only against other people, so a self-click cannot happen
 * by accident either.
 */
export function AdminUser() {
  const { userId = "" } = useParams();
  const detail = useAdminUser(userId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [pendingDevice, setPendingDevice] = useState<Device | null>(null);
  const [pendingClient, setPendingClient] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);

  const user = detail.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.adminUsers });
    queryClient.invalidateQueries({ queryKey: keys.adminUser(userId) });
    queryClient.invalidateQueries({ queryKey: keys.adminOverview });
  };

  const revokeDevice = useMutation({
    mutationFn: (device: Device) => api.adminRevokeDevice(userId, device.id),
    onSuccess: (_result, device) => {
      toast(`${device.name} was revoked.`);
      setPendingDevice(null);
      invalidate();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not revoke.", "error");
      setPendingDevice(null);
    },
  });

  const revokeClient = useMutation({
    mutationFn: (client: Client) => api.adminRevokeClient(userId, client.id),
    onSuccess: (_result, client) => {
      toast(`${clientLabel(client)} was revoked.`);
      setPendingClient(null);
      invalidate();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not revoke.", "error");
      setPendingClient(null);
    },
  });

  async function removeUser() {
    setDeleteWorking(true);
    try {
      await api.adminDeleteUser(userId);
      toast(`${user?.email ?? "User"} was deleted.`);
      invalidate();
      navigate("/admin");
    } catch (error) {
      setDeleteWorking(false);
      setDeleting(false);
      toast(error instanceof Error ? error.message : "Could not delete the user.", "error");
    }
  }

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title="User" />
        <Card>
          <SkeletonRows count={4} />
        </Card>
      </>
    );
  }

  if (detail.isError) {
    return (
      <>
        <PageHeader title="User" />
        <ErrorBanner
          error={detail.error}
          title="Could not load this account"
          onRetry={() => {
            void detail.refetch();
          }}
        />
      </>
    );
  }

  if (!user) {
    return (
      <PageHeader
        title="User"
        subtitle="That account is gone, or the id never pointed at one."
        action={
          <Link to="/admin" className="btn">
            Back
          </Link>
        }
      />
    );
  }

  const machines = user.machineList;
  const clients = user.clientList;
  const busy = revokeDevice.isPending || revokeClient.isPending || deleteWorking;

  return (
    <>
      <PageHeader
        title={user.name ?? user.email}
        subtitle={`${user.email} · joined ${formatDate(user.createdAt)}`}
        action={
          <Link to="/admin" className="btn">
            All users
          </Link>
        }
      />

      <div className="mb-6 flex items-center gap-3">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt=""
            width={40}
            height={40}
            className="border-border size-10 rounded-full border"
          />
        )}
        <p className="text-body-md text-foreground-muted">
          {user.lastActivityAt
            ? `Last activity ${relativeTime(user.lastActivityAt)}.`
            : "No tool calls recorded yet."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Online" value={`${user.devicesOnline}`} hint={`of ${user.devices} machines`} />
        <Stat label="Projects" value={`${user.projects}`} />
        <Stat label="Clients" value={`${user.clients}`} hint="active authorizations" />
        <Stat label="Calls" value={`${user.toolCalls}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Machines">
          {machines.length === 0 ? (
            <EmptyState title="No machines">None registered on this account.</EmptyState>
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
                        {device.revokedAt
                          ? ` · revoked ${relativeTime(device.revokedAt)}`
                          : isOnline(device)
                            ? " · online"
                            : ` · last seen ${relativeTime(device.lastSeenAt)}`}
                      </p>
                    </div>
                  </div>
                  {!device.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-danger shrink-0"
                      disabled={busy}
                      onClick={() => setPendingDevice(device)}
                    >
                      Revoke
                    </button>
                  )}
                </Row>
              ))}
            </Divided>
          )}
        </Card>

        <Card title="Clients">
          {clients.length === 0 ? (
            <EmptyState title="No clients">No authorizations on this account.</EmptyState>
          ) : (
            <Divided>
              {clients.map((client) => (
                <Row key={client.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-title-md truncate">{clientLabel(client)}</p>
                      {client.revokedAt && <Badge tone="error">revoked</Badge>}
                      <Badge>{client.endpoint}</Badge>
                    </div>
                    <p className="text-body-md text-foreground-faint truncate">
                      authorized {relativeTime(client.authorizedAt)}
                      {client.lastUsedAt ? ` · used ${relativeTime(client.lastUsedAt)}` : ""}
                    </p>
                  </div>
                  {!client.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-danger shrink-0"
                      disabled={busy}
                      onClick={() => setPendingClient(client)}
                    >
                      Revoke
                    </button>
                  )}
                </Row>
              ))}
            </Divided>
          )}
        </Card>
      </div>

      <Card title="Projects" className="mt-6">
        {user.projectList.length === 0 ? (
          <EmptyState title="No projects">Nothing registered yet.</EmptyState>
        ) : (
          <Divided>
            {user.projectList.map((project) => (
              <Row key={project.id}>
                <div className="min-w-0">
                  <p className="text-title-md truncate">{project.name}</p>
                  <p className="text-body-md text-foreground-faint truncate font-mono">
                    {shortenPath(project.localPath)}
                  </p>
                </div>
                <span className="text-body-md text-foreground-faint shrink-0">
                  {formatDate(project.createdAt)}
                </span>
              </Row>
            ))}
          </Divided>
        )}
      </Card>

      <Card title="Recent activity" className="mt-6">
        {user.recentCalls.length === 0 ? (
          <EmptyState title="No tool calls yet">
            Nothing has been recorded for this account.
          </EmptyState>
        ) : (
          <Divided>
            {user.recentCalls.map((call) => (
              <Row key={call.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                  <code className="text-body-md truncate font-mono">{call.tool}</code>
                  {call.clientName && (
                    <span className="text-body-md text-foreground-faint hidden truncate sm:inline">
                      {call.clientName}
                    </span>
                  )}
                </div>
                <div className="text-body-md text-foreground-faint flex shrink-0 items-center gap-3">
                  <span>{formatDuration(call.durationMs)}</span>
                  <span>{relativeTime(call.createdAt)}</span>
                </div>
              </Row>
            ))}
          </Divided>
        )}
      </Card>

      <section className="border-error/30 bg-surface mt-6 rounded-xl border p-5">
        <h2 className="text-title-lg text-error">Danger</h2>
        <p className="text-body-md text-foreground-muted mt-1.5">
          Permanent. Removes every machine, project, authorization and activity row for this
          account.
        </p>
        <button
          type="button"
          className="btn btn-danger mt-4"
          disabled={busy}
          onClick={() => setDeleting(true)}
        >
          Delete user
        </button>
      </section>

      <ConfirmDialog
        open={pendingDevice !== null}
        title={`Revoke ${pendingDevice?.name ?? ""}?`}
        body="Its connection is closed immediately and it stops serving tool calls for this account."
        confirmLabel="Revoke"
        pending={revokeDevice.isPending}
        onCancel={() => setPendingDevice(null)}
        onConfirm={() => {
          if (pendingDevice) revokeDevice.mutate(pendingDevice);
        }}
      />

      <ConfirmDialog
        open={pendingClient !== null}
        title={`Revoke ${pendingClient ? clientLabel(pendingClient) : ""}?`}
        body="That client loses access to the project it was authorized for. The row stays so it can be deleted later."
        confirmLabel="Revoke"
        pending={revokeClient.isPending}
        onCancel={() => setPendingClient(null)}
        onConfirm={() => {
          if (pendingClient) revokeClient.mutate(pendingClient);
        }}
      />

      <ConfirmDialog
        open={deleting}
        title={`Delete ${user.email}?`}
        body="Every machine is cut off, every project and authorization is removed, and the activity log goes with them. There is no way back."
        confirmLabel="Delete user"
        confirmText={user.email}
        pending={deleteWorking}
        onConfirm={removeUser}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}

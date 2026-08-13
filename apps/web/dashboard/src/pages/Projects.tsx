import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, isOnline, type Project } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CopyButton } from "../components/CopyButton.js";
import { useToast } from "../components/toast.js";
import { Card, EmptyState, PageHeader, Skeleton, StatusDot } from "../components/ui.js";
import { keys, useDevices, useMe, useProjects } from "../queries.js";

export function Projects() {
  const projects = useProjects();
  const devices = useDevices();
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingRemove, setPendingRemove] = useState<Project | null>(null);

  const remove = useMutation({
    mutationFn: api.removeProject,
    onSuccess: (_result, id) => {
      const name = projects.data?.find((project) => project.id === id)?.name ?? "The project";
      toast(`${name} was removed. Its MCP URL no longer resolves.`);
      setPendingRemove(null);
      queryClient.invalidateQueries({ queryKey: keys.projects });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not remove.", "error");
      setPendingRemove(null);
    },
  });

  const rows = projects.data ?? [];

  if (projects.isError || devices.isError || me.isError) {
    return <PageHeader title="Projects" subtitle="Project data is temporarily unavailable." />;
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="One MCP endpoint each, plus one URL that covers them all. Added from the CLI, because only the machine knows its own paths."
      />

      {/* First, because it is the one URL that keeps working as projects come
          and go: a client added once here never has to be reconfigured. */}
      {me.data && <AccountEndpointCard url={me.data.accountMcpUrl} />}

      {projects.isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="border-border bg-surface rounded-xl border">
          <EmptyState title="No projects yet">
            On a registered machine, run <code className="font-mono">exeora project add .</code>
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((project) => {
            const device = devices.data?.find((candidate) => candidate.id === project.deviceId);
            return (
              <article key={project.id} className="border-border bg-surface rounded-xl border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="text-title-lg hover:text-brand transition-colors duration-fast"
                    >
                      {project.name}
                    </Link>
                    <p className="text-body-md text-foreground-faint mt-1 flex items-center gap-2">
                      <StatusDot
                        on={device ? isOnline(device) : false}
                        label={device && isOnline(device) ? "machine online" : "machine offline"}
                      />
                      <span className="truncate">
                        {device?.name ?? "unknown machine"} · {project.localPath}
                      </span>
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn btn-danger shrink-0"
                    onClick={() => setPendingRemove(project)}
                  >
                    Remove
                  </button>
                </div>

                <div className="border-border bg-bg mt-4 flex items-center gap-3 rounded-lg border px-3 py-2">
                  <code className="text-body-md text-foreground-muted min-w-0 flex-1 truncate font-mono">
                    {project.mcpUrl}
                  </code>
                  <CopyButton value={project.mcpUrl} label="Copy URL" />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove ${pendingRemove?.name ?? ""}?`}
        body="Its MCP URL stops resolving, so any client still pointed at it will start failing. The files on the machine are untouched."
        confirmLabel="Remove"
        pending={remove.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && remove.mutate(pendingRemove.id)}
      />
    </>
  );
}

/**
 * The account URL, offered above the per-project ones.
 *
 * It says what it costs as well as what it gives, in the place where the choice
 * between the two is actually made. The projects it reaches are picked on the
 * consent screen when a client is authorized, so this card only has to hand
 * over the address.
 */
function AccountEndpointCard({ url }: { url: string }) {
  const claudeCode = `claude mcp add --transport http exeora ${url}`;

  return (
    <Card
      title="One URL for everything"
      subtitle="Add it once. The client picks a project, and switches between them itself."
      className="mb-6"
    >
      <div className="p-5">
        <div className="border-border bg-bg flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <code className="text-body-md text-foreground min-w-0 flex-1 truncate font-mono">
            {url}
          </code>
          <CopyButton value={url} label="Copy" />
        </div>

        <div className="border-border bg-bg mt-2.5 flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <code className="text-body-md text-foreground-muted min-w-0 flex-1 truncate font-mono">
            {claudeCode}
          </code>
          <CopyButton value={claudeCode} label="Copy" />
        </div>

        <p className="text-body-md text-foreground-muted mt-5">
          You choose which projects it reaches when you authorize it, and can change that from
          Clients afterwards. A project's own URL below is narrower: a client on it can reach that
          project and has no way to name another.
        </p>
      </div>
    </Card>
  );
}

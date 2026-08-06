import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, isOnline, type Project } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CopyButton } from "../components/CopyButton.js";
import { useToast } from "../components/toast.js";
import { EmptyState, PageHeader, Skeleton, StatusDot } from "../components/ui.js";
import { keys, useDevices, useProjects } from "../queries.js";

export function Projects() {
  const projects = useProjects();
  const devices = useDevices();
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

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="One MCP endpoint each. Added from the CLI, because only the machine knows its own paths."
      />

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
        body="Its MCP URL stops resolving, so any client still pointed at it will start failing. The files on your machine are untouched."
        confirmLabel="Remove"
        pending={remove.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && remove.mutate(pendingRemove.id)}
      />
    </>
  );
}

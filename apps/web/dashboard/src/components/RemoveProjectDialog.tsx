import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorText, type Project } from "../api.js";
import type { Machine } from "../api-projects.js";
import { cloudLocation, instanceLabel, instancesOf } from "../projectModel.js";
import { keys, refreshPlaces } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";

/**
 * The one way a project is removed.
 *
 * It used to be offered on two pages with two different warnings. It is
 * offered from the project's own page now, and from the instance that carries
 * a project living only on Exeora Cloud, and both open this: the same list of
 * what goes, the same request.
 */
export function RemoveProjectDialog({
  project,
  machines,
  workspaceCount,
  onClose,
  onRemoved,
}: {
  project: Project | null;
  machines: readonly Machine[];
  /** Left out where the page has not loaded the project's workspaces. */
  workspaceCount?: number;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const instances = project ? instancesOf(machines, project.id) : [];
  const onCloud = project ? cloudLocation(project) !== null : false;

  const remove = useMutation({
    mutationFn: (target: Project) => api.removeProject(target.id),
    onSuccess: (_result, target) => {
      toast(
        onCloud
          ? `Removing ${target.name}. It leaves the list once its instances are destroyed.`
          : `${target.name} was removed. Its MCP URL no longer resolves.`,
      );
      void refreshPlaces(queryClient);
      void queryClient.invalidateQueries({ queryKey: keys.clients });
      void queryClient.invalidateQueries({ queryKey: keys.accountClients });
      onClose();
      onRemoved?.();
    },
    onError: (error) => {
      toast(errorText(error, "The project could not be removed."), "error");
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={project !== null}
      title={`Remove ${project?.name ?? ""}?`}
      body="This cannot be undone. It destroys:"
      details={
        project ? (
          <ul className="text-body-md text-foreground-muted mt-1 list-disc space-y-1 pl-5">
            <li>Its MCP URL. Any client still pointed at it starts failing.</li>
            <li>Its activity history, and the access its clients were given.</li>
            {workspaceCount !== undefined && workspaceCount > 0 ? (
              <li>
                The record of its {workspaceCount}{" "}
                {workspaceCount === 1 ? "workspace" : "workspaces"}.
              </li>
            ) : null}
            {instances.length > 0 ? (
              <li>
                {instances.length === 1 ? "The instance" : `The ${instances.length} instances`} on
                Exeora Cloud ({instances.map(instanceLabel).join(", ")}), with anything that was not
                pushed from {instances.length === 1 ? "it" : "them"}.
              </li>
            ) : null}
            {project.locations
              .filter((location) => location.kind === "local")
              .map((location) => (
                <li key={location.id}>
                  Nothing on {location.name}: the files there are left as they are, no longer
                  served.
                </li>
              ))}
            <li>Nothing in the repository itself.</li>
          </ul>
        ) : null
      }
      confirmLabel="Remove project"
      pending={remove.isPending}
      onCancel={onClose}
      onConfirm={() => project && remove.mutate(project)}
    />
  );
}

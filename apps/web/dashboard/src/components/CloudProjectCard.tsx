import { Link } from "react-router";
import { relativeTime } from "../api.js";
import type { CloudMachine, CloudProject } from "../api-cloud.js";
import { Badge, Card, Divided, Row, StatusDot } from "./ui.js";

/** Where a machine is in its life, in the words the row shows. */
export function machineState(machine: CloudMachine): {
  tone: "neutral" | "success" | "error" | "brand";
  badge: string;
  detail: string;
} {
  switch (machine.status) {
    case "creating":
      return { tone: "brand", badge: "creating", detail: machine.step ?? "Starting" };
    case "ready":
      return machine.online
        ? { tone: "success", badge: "ready", detail: "online" }
        : { tone: "success", badge: "ready", detail: "sleeping · wakes on the next call" };
    case "error":
      return { tone: "error", badge: "failed", detail: machine.error ?? "Provisioning failed." };
    case "destroying":
      return { tone: "neutral", badge: "removing", detail: "Taking the machine down" };
  }
}

/** The Workspace page for a machine; `main` is the project root there. */
export function workspaceHref(project: CloudProject, machine: CloudMachine): string {
  const params = new URLSearchParams({ project: project.projectId });
  if (machine.workspaceId) params.set("workspace", machine.workspaceSlug);
  return `/workspace?${params}`;
}

export function CloudProjectCard({
  project,
  busy,
  full,
  canProvision,
  onAddWorkspace,
  onSetCredential,
  onRemoveProject,
  onRemoveWorkspace,
  onRetry,
}: {
  project: CloudProject;
  busy: boolean;
  /** At the plan's cap: nothing that makes a machine, everything else still works. */
  full: boolean;
  /** Whether the account may build machines at all; removing needs no permission. */
  canProvision: boolean;
  onAddWorkspace: () => void;
  onSetCredential: () => void;
  onRemoveProject: () => void;
  onRemoveWorkspace: (machine: CloudMachine) => void;
  onRetry: (machine: CloudMachine) => void;
}) {
  const removing = project.machines.some((machine) => machine.status === "destroying");
  return (
    <Card
      title={project.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${project.projectId}`} className="btn">
            Project
          </Link>
          <button
            type="button"
            className="btn"
            disabled={busy || full || !canProvision || removing}
            onClick={onAddWorkspace}
          >
            Add workspace
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || removing}
            onClick={onSetCredential}
          >
            {project.hasCredential ? "Replace token" : "Set token"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || removing}
            onClick={onRemoveProject}
          >
            Remove
          </button>
        </div>
      }
    >
      <div className="border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3">
        <code className="text-body-md text-foreground-muted min-w-0 truncate font-mono">
          {project.repoUrl}
        </code>
        <span className="text-body-md text-foreground-faint font-mono">
          {project.defaultBranch}
        </span>
        {project.hasCredential && <Badge>private</Badge>}
      </div>
      <Divided>
        {project.machines.map((machine) => {
          const state = machineState(machine);
          return (
            <Row key={machine.deviceId}>
              <div className="flex min-w-0 items-center gap-3">
                <StatusDot on={machine.online} label={machine.online ? "online" : "offline"} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-title-md truncate font-mono">{machine.workspaceSlug}</p>
                    <Badge tone={state.tone}>{state.badge}</Badge>
                  </div>
                  <p
                    className={`text-body-md truncate ${
                      machine.status === "error" ? "text-error" : "text-foreground-faint"
                    }`}
                    title={state.detail}
                  >
                    {machine.branch && machine.branch !== machine.workspaceSlug
                      ? `${machine.branch} · `
                      : ""}
                    {state.detail}
                    {machine.status === "ready" && !machine.online && machine.readyAt
                      ? ` · ready ${relativeTime(machine.readyAt)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {machine.status === "ready" && (
                  <Link to={workspaceHref(project, machine)} className="btn">
                    Open workspace
                  </Link>
                )}
                {machine.status === "error" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !canProvision}
                    onClick={() => onRetry(machine)}
                  >
                    Retry
                  </button>
                )}
                {machine.workspaceId && machine.status !== "destroying" && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => onRemoveWorkspace(machine)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </Row>
          );
        })}
      </Divided>
    </Card>
  );
}

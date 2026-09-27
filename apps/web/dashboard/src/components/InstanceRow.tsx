import { Link } from "react-router";
import { relativeTime } from "../api.js";
import type { CloudInstance } from "../api-projects.js";
import { instanceLabel, workspaceHref } from "../projectModel.js";
import { isReachable, runtimeHint } from "../states.js";
import { MachineFailure, needsToken } from "./MachineFailure.js";
import { Fact, MachineRow } from "./MachineRow.js";
import { Badge } from "./ui.js";
import type { InstanceControls } from "./WorkspaceControls.js";

/**
 * An instance of Exeora Cloud, the same row in both lenses.
 *
 * Under a project it is a workspace of that project; on the Machines page it
 * is a machine that is running. It is one thing, so it is one row with one set
 * of actions, and the only difference between the two is that the Machines
 * page has to say which project it belongs to.
 */
export function InstanceRow({
  instance,
  lens,
  controls,
  note,
}: {
  instance: CloudInstance;
  /** Which page is showing it. Decides only what the page already says around it. */
  lens: "project" | "machines";
  controls: InstanceControls;
  note?: string;
}) {
  const root = instance.workspace.id === null;
  const label = instanceLabel(instance);
  const failed = instance.state === "failed";
  const credential = controls.credentialLabel(instance);

  return (
    <MachineRow
      state={instance.state}
      stateHint={instance.state === "setting up" ? instance.step : runtimeHint(instance.runtime)}
      title={
        <span className="font-mono">
          {lens === "machines" ? (
            <>
              <Link
                to={`/projects/${instance.project.id}`}
                className="hover:text-brand font-sans underline-offset-2 hover:underline"
              >
                {instance.project.name}
              </Link>
              <span className="text-foreground-faint"> / </span>
            </>
          ) : null}
          <span>{root ? (instance.workspace.branch ?? "") : label}</span>
        </span>
      }
      // The root is its real branch with the mark beside it, the same way the
      // root of a machine is drawn.
      badges={root ? <Badge>default branch</Badge> : null}
      meta={
        <>
          {root ? "" : `${instance.workspace.slug} · `}created {relativeTime(instance.createdAt)}
          {instance.state === "online"
            ? " · active now"
            : instance.lastSeenAt
              ? ` · last active ${relativeTime(instance.lastSeenAt)}`
              : ""}
        </>
      }
      failure={failed ? <MachineFailure machine={instance} /> : null}
      note={note}
      menuLabel={`Actions for ${label}`}
      busy={controls.busy}
      actions={
        <>
          {failed && needsToken(instance) && credential ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={controls.busy || !controls.canProvision}
              onClick={() => controls.setCredential(instance)}
            >
              {credential}
            </button>
          ) : null}
          {failed ? (
            <button
              type="button"
              className="btn"
              disabled={controls.busy || !controls.canProvision}
              onClick={() => controls.retry(instance)}
            >
              Retry
            </button>
          ) : null}
          {isReachable(instance.state) && controls.canOpen(instance) ? (
            <Link
              to={workspaceHref(instance.project.id, root ? null : instance.workspace.slug)}
              className="btn"
            >
              Open workspace
            </Link>
          ) : null}
        </>
      }
      menu={instance.state === "removing" ? [] : controls.removalItems(instance, lens)}
      // Not "Details", which is what a failure calls the log behind it: a row
      // that failed would otherwise have two disclosures under one name.
      detailsLabel="About this instance"
      details={
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact label="Instance">{instance.name}</Fact>
          <Fact label="CLI">{instance.cliVersion ?? "unknown"}</Fact>
          <Fact label="Ready">{instance.readyAt ? relativeTime(instance.readyAt) : "not yet"}</Fact>
        </dl>
      }
    />
  );
}

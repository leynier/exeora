import type { ReactNode } from "react";
import { Menu, type MenuItem } from "./Menu.js";
import { StateBadge } from "./StateBadge.js";

/**
 * One row for anything that runs or holds a working copy: a machine of the
 * person's, an instance of Exeora Cloud, a workspace under a location.
 *
 * The Projects lens and the Machines lens both draw their rows with this, so
 * the same thing is laid out the same way wherever it turns up: the state and
 * the name first, one line of what matters under them, the one action most
 * people came for on the right, and the rest behind the menu and the
 * disclosure.
 */
export function MachineRow({
  state,
  stateHint,
  title,
  badges,
  meta,
  failure,
  note,
  actions,
  menu = [],
  menuLabel,
  busy = false,
  details,
  detailsLabel,
}: {
  /** Left out for a workspace on a machine, which is as reachable as the machine. */
  state?: string | null;
  stateHint?: string | null;
  title: ReactNode;
  badges?: ReactNode;
  /** One line under the name: what it is, where, since when. */
  meta?: ReactNode;
  /** Why it failed, when it did. */
  failure?: ReactNode;
  /** What the person should know before acting, when the row is not self-evident. */
  note?: ReactNode;
  /** The primary action, and at most one more that answers the row's state. */
  actions?: ReactNode;
  menu?: readonly MenuItem[];
  menuLabel: string;
  busy?: boolean;
  /** Paths, versions and whatever else is reference material. */
  details?: ReactNode;
  /** What the disclosure is called, which is what it holds. */
  detailsLabel?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {state ? <StateBadge state={state} hint={stateHint} /> : null}
            <div className="text-title-md min-w-0 truncate">{title}</div>
            {badges}
          </div>
          {meta ? <p className="text-body-md text-foreground-faint mt-1 truncate">{meta}</p> : null}
          {failure ? <div className="mt-2">{failure}</div> : null}
          {note ? <p className="text-body-md text-foreground-muted mt-2">{note}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
          <Menu label={menuLabel} items={menu} disabled={busy} />
        </div>
      </div>
      {details ? (
        <details className="mt-2">
          <summary className="text-body-md text-foreground-faint hover:text-foreground">
            {detailsLabel}
          </summary>
          <div className="mt-2">{details}</div>
        </details>
      ) : null}
    </div>
  );
}

/** A label and its value, for the reference material behind a disclosure. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label-md text-foreground-faint font-mono uppercase">{label}</dt>
      <dd className="text-body-md mt-0.5 font-mono break-all">{children}</dd>
    </div>
  );
}

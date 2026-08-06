import { DangerZone } from "../components/DangerZone.js";
import { PageHeader } from "../components/ui.js";

/**
 * Account-level preferences and irreversible actions.
 *
 * Settings is the place for things that are about the signed-in person rather
 * than a machine, a project or a client. The danger section lives here so the
 * overview can stay about the state of the fleet, and so anything else that
 * cannot be undone has a single home.
 */
export function Settings() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Account preferences and irreversible actions." />

      <DangerZone />
    </>
  );
}

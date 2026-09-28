import { CloudMachineNotice } from "../CloudMachineNotice.js";
import { EmptyState } from "../ui.js";

/**
 * What a view shows when the machine cannot serve it: offline, or a CLI from
 * before the view existed. Each view degrades on its own, so an older CLI
 * still gets the Source Control it always had while the Explorer says what
 * it is waiting for.
 */
export function TabUnavailable({
  reason,
  feature,
  machineName,
  cloud,
  projectId,
  workspaceId,
}: {
  reason: "offline" | "update";
  /** The view's name in a sentence: "the Explorer", "Search". */
  feature: string;
  machineName: string | undefined;
  cloud: boolean;
  projectId: string;
  workspaceId: string | undefined;
}) {
  const machine = machineName ?? "the machine that holds this workspace";
  if (reason === "offline" && cloud) {
    return <CloudMachineNotice projectId={projectId} workspaceId={workspaceId ?? null} />;
  }
  return (
    <EmptyState title={reason === "offline" ? `${machine} is offline` : "CLI update required"}>
      {reason === "offline" ? (
        <>
          Run <code className="font-mono">exeora connect</code> on {machine}. This view opens on its
          own once it is back.
        </>
      ) : (
        `Update the Exeora CLI on ${machine} to use ${feature}.`
      )}
    </EmptyState>
  );
}

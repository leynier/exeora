import type { AccountClient, Project } from "./api.js";
import type { Machine } from "./api-projects.js";
import { clientLabel } from "./format.js";
import { instanceLabel, instancesOf } from "./projectModel.js";
import { livesNowhere } from "./survival.js";

/**
 * What is wrong right now, and where each of those things is put right.
 *
 * The overview is the only page that looks across everything, so it is the
 * one that can say "this needs you" without being asked. Each entry names the
 * cause in a sentence and carries the link to the page that fixes it.
 */

export interface AttentionItem {
  key: string;
  /** What is wrong, in a sentence. */
  title: string;
  /** What to do about it. */
  action: string;
  to: string;
  linkLabel: string;
}

/** Whether a release is older than another, by its three numbers. Unreadable versions are not. */
export function olderThan(version: string | null | undefined, latest: string): boolean {
  const parse = (value: string) =>
    value
      .split("-")[0]
      ?.split(".")
      .map((part) => Number.parseInt(part, 10)) ?? [];
  const have = parse(version ?? "");
  const want = parse(latest);
  if (have.length !== 3 || want.length !== 3) return false;
  if ([...have, ...want].some((part) => Number.isNaN(part))) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = have[index] ?? 0;
    const b = want[index] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function attentionItems(input: {
  projects: readonly Project[];
  machines: readonly Machine[];
  accountClients: readonly AccountClient[];
  /** The release machines should be on, when the gateway says. */
  latestCliVersion?: string | null | undefined;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Only the person's own machines: Exeora Cloud installs the release it
  // wants on the instances it runs.
  if (input.latestCliVersion) {
    for (const machine of input.machines) {
      if (machine.kind !== "local" || machine.state === "removed") continue;
      if (!olderThan(machine.cliVersion, input.latestCliVersion)) continue;
      items.push({
        key: `cli:${machine.deviceId}`,
        title: `${machine.name} runs Exeora ${machine.cliVersion}, and ${input.latestCliVersion} is out.`,
        action: "Run `exeora upgrade` on it, then `exeora connect` again.",
        to: "/machines",
        linkLabel: "Open Machines",
      });
    }
  }

  for (const instance of instancesOf(input.machines)) {
    if (instance.state !== "failed") continue;
    items.push({
      key: `instance:${instance.deviceId}`,
      title: `The instance for ${instanceLabel(instance)} of ${instance.project.name} failed.`,
      action: instance.error ?? "Retry it, and check the details if it fails again.",
      to: "/machines?view=cloud&state=failed",
      linkLabel: "Open Machines",
    });
  }

  for (const project of input.projects) {
    // Exeora Cloud with no instance is not listed: it is a place at rest, and
    // the next call to the project root makes the instance.
    if (livesNowhere(project)) {
      items.push({
        key: `nowhere:${project.id}`,
        title: `${project.name} lives nowhere.`,
        action: "Add a location.",
        to: `/projects/${project.id}`,
        linkLabel: "Open project",
      });
    }
    for (const location of project.locations) {
      // A failed instance of the project root is the Cloud location failing,
      // and it is already listed above as the instance it is.
      if (location.kind === "cloud" || location.status !== "error") continue;
      items.push({
        key: `location:${location.id}`,
        title: `${project.name} could not be cloned on ${location.name}.`,
        action: location.error ?? "Open the project to see what the machine said.",
        to: `/projects/${project.id}`,
        linkLabel: "Open project",
      });
    }
    if (project.github?.lostAccess) {
      items.push({
        key: `github:${project.id}`,
        title: `${project.name} lost access to ${project.github.fullName} on GitHub.`,
        action: "Give Exeora the repository again from the GitHub settings.",
        to: "/settings",
        linkLabel: "Open Settings",
      });
    }
  }

  for (const client of input.accountClients) {
    const reaches = client.projects.some((entry) => entry.revokedAt === null);
    if (client.allProjects || reaches) continue;
    items.push({
      key: `client:${client.clientId}`,
      title: `${clientLabel(client)} cannot reach any project.`,
      action: "Authorize it again from the client, then choose its projects.",
      to: "/clients",
      linkLabel: "Open Clients",
    });
  }

  return items;
}

import type { ProjectView } from "./api.js";
import type { ProjectEntry } from "./config.js";

/**
 * What the gateway believes about this machine's projects, against what the
 * local config remembers.
 *
 * The gateway is the authority: projects deleted from the dashboard disappear
 * there while the local config keeps serving ghosts, so `sync` re-mirrors the
 * remote list. Pure, and separate from applying it, so the four outcomes are
 * testable without touching the config file.
 */

export interface Reconciliation {
  /** The local project list as it should be stored after syncing. */
  next: ProjectEntry[];
  /** Gone from the gateway, or repointed at another machine. */
  removed: ProjectEntry[];
  /** Served by this machine according to the gateway, but unknown locally. */
  added: ProjectEntry[];
  /** Present on both sides, with the gateway's record winning the drift. */
  updated: ProjectEntry[];
}

export function reconcile(
  local: ProjectEntry[],
  remote: ProjectView[],
  deviceId: string,
): Reconciliation {
  // Only this machine's records: a checkout served from another device must
  // neither be pulled in nor treated as the local entry's fate.
  const authority = remote.filter((entry) => entry.deviceId === deviceId);
  const byId = new Map(authority.map((entry) => [entry.id, entry]));

  const kept: ProjectEntry[] = [];
  const removed: ProjectEntry[] = [];
  const updated: ProjectEntry[] = [];

  for (const entry of local) {
    const record = byId.get(entry.id);
    if (!record) {
      removed.push(entry);
      continue;
    }

    const current = asEntry(record);
    if (current.slug !== entry.slug || current.name !== entry.name || current.root !== entry.root) {
      updated.push(current);
      kept.push(current);
    } else {
      kept.push(entry);
    }
  }

  const known = new Set(local.map((entry) => entry.id));
  const added = authority.filter((entry) => !known.has(entry.id)).map(asEntry);

  return { next: [...kept, ...added], removed, added, updated };
}

function asEntry(record: ProjectView): ProjectEntry {
  return { id: record.id, slug: record.slug, name: record.name, root: record.localPath };
}

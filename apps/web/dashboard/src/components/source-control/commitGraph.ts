import type { GitCommit } from "../../api-types-workspace.js";

/**
 * The lanes of a commit graph, worked out from parents alone.
 *
 * Commits arrive newest first. Each lane holds the commit it expects to see
 * next; a commit takes the lane that expected it (or a free one), hands the
 * lane to its first parent, and sends its other parents to their own lanes,
 * which is where a merge's second line comes from. Two lanes waiting for the
 * same commit meet at it, which is where a branch comes back.
 */

export type GraphEdge = {
  /** Lane at this row. */
  from: number;
  /** Lane at the next row. */
  to: number;
  /** A line between rows that this row's commit is not on. */
  through?: boolean;
};

export type GraphRow = {
  oid: string;
  /** The lane the commit sits on. */
  lane: number;
  /** Lines from this row down to the next. */
  edges: GraphEdge[];
  /** How many lanes are in use at this row, for the column's width. */
  width: number;
};

export function commitGraph(commits: readonly Pick<GitCommit, "oid" | "parents">[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // The lanes waiting for this commit before it takes one.
    const waiting = lanes
      .map((oid, index) => (oid === commit.oid ? index : -1))
      .filter((i) => i >= 0);
    let lane = waiting[0] ?? -1;
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.push(null) - 1;
    }
    const before = lanes.length;
    const edges: GraphEdge[] = [];

    // Other lanes that were waiting for it join here.
    for (const index of waiting.slice(1)) {
      lanes[index] = null;
    }
    // Lines that pass this row by.
    lanes.forEach((oid, index) => {
      if (index !== lane && oid !== null) edges.push({ from: index, to: index, through: true });
    });

    const [first, ...others] = commit.parents;
    lanes[lane] = first ?? null;
    if (first !== undefined) {
      // A parent already awaited elsewhere: this lane ends and bends into that one.
      const elsewhere = lanes.findIndex((oid, index) => index !== lane && oid === first);
      if (elsewhere >= 0) {
        lanes[lane] = null;
        edges.push({ from: lane, to: elsewhere });
      } else {
        edges.push({ from: lane, to: lane });
      }
    }
    for (const parent of others) {
      let target = lanes.indexOf(parent);
      if (target < 0) {
        target = lanes.indexOf(null);
        if (target < 0) target = lanes.push(null) - 1;
        lanes[target] = parent;
      }
      edges.push({ from: lane, to: target });
    }

    // Trailing lanes that ended are trimmed so the graph does not keep their width.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ oid: commit.oid, lane, edges, width: Math.max(before, lanes.length, lane + 1) });
  }
  return rows;
}

/** A decoration as `git log --decorate` prints it, split into what it names. */
export function parseRef(ref: string): {
  name: string;
  kind: "head" | "branch" | "remote" | "tag";
} {
  if (ref.startsWith("HEAD -> ")) return { name: ref.slice(8), kind: "head" };
  if (ref === "HEAD") return { name: "HEAD", kind: "head" };
  if (ref.startsWith("tag: ")) return { name: ref.slice(5), kind: "tag" };
  if (ref.includes("/")) return { name: ref, kind: "remote" };
  return { name: ref, kind: "branch" };
}

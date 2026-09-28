import type { GraphRow } from "./commitGraph.js";

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 36;

const COLOURS = ["#4fd1c5", "#9aa2ab", "#fbbf24", "#34d399", "#f87171", "#c084fc"];

/**
 * One row of the graph: the dot for the commit and the lines to the next row.
 * Drawn per row so the list can be long without one enormous SVG, and so a
 * row that is not on screen costs nothing.
 */
export function HistoryGraph({ row, maxWidth }: { row: GraphRow; maxWidth: number }) {
  const width = Math.max(row.width, 1) * LANE_WIDTH;
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const half = ROW_HEIGHT / 2;
  return (
    <svg
      aria-hidden="true"
      width={Math.max(width, Math.min(maxWidth, 6) * LANE_WIDTH)}
      height={ROW_HEIGHT}
      className="shrink-0"
    >
      {row.edges.map((edge) => {
        const colour = COLOURS[(edge.through ? edge.from : edge.to) % COLOURS.length];
        const from = edge.through ? 0 : half;
        const path =
          edge.from === edge.to
            ? `M${x(edge.from)},${from} L${x(edge.to)},${ROW_HEIGHT}`
            : `M${x(edge.from)},${half} C${x(edge.from)},${ROW_HEIGHT} ${x(edge.to)},${half} ${x(edge.to)},${ROW_HEIGHT}`;
        return (
          <path
            key={`${edge.from}-${edge.to}-${edge.through ? "t" : "c"}`}
            d={path}
            fill="none"
            stroke={colour}
            strokeWidth={1.5}
          />
        );
      })}
      {/* The lines that reach this commit from the row above. */}
      <path
        d={`M${x(row.lane)},0 L${x(row.lane)},${half}`}
        fill="none"
        stroke={COLOURS[row.lane % COLOURS.length]}
        strokeWidth={1.5}
      />
      <circle
        cx={x(row.lane)}
        cy={half}
        r={3.5}
        fill="var(--color-surface)"
        stroke={COLOURS[row.lane % COLOURS.length]}
        strokeWidth={1.5}
      />
    </svg>
  );
}

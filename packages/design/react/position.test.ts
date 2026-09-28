import { describe, expect, it } from "vitest";
import { placeAnchored, placeAtPoint } from "./position.js";

const viewport = { width: 1000, height: 600 };

describe("placeAnchored", () => {
  it("hangs below the anchor by default", () => {
    const placed = placeAnchored(
      { top: 100, left: 100, width: 40, height: 20 },
      { width: 200, height: 100 },
      viewport,
    );
    expect(placed).toEqual({ top: 126, left: 100, side: "bottom" });
  });

  it("flips above when there is no room below and more above", () => {
    const placed = placeAnchored(
      { top: 550, left: 100, width: 40, height: 20 },
      { width: 200, height: 100 },
      viewport,
    );
    expect(placed.side).toBe("top");
    expect(placed.top).toBe(444);
  });

  it("stays on the wanted side when neither fits but that side has more room", () => {
    const placed = placeAnchored(
      { top: 10, left: 0, width: 10, height: 10 },
      { width: 100, height: 800 },
      viewport,
      { side: "bottom" },
    );
    expect(placed.side).toBe("bottom");
  });

  it("slides sideways to keep the panel inside the viewport", () => {
    const placed = placeAnchored(
      { top: 10, left: 950, width: 40, height: 20 },
      { width: 200, height: 50 },
      viewport,
    );
    expect(placed.left).toBe(792);
  });

  it("aligns to the end of the anchor", () => {
    const placed = placeAnchored(
      { top: 10, left: 500, width: 40, height: 20 },
      { width: 200, height: 50 },
      viewport,
      { align: "end" },
    );
    expect(placed.left).toBe(340);
  });

  it("centres across the anchor", () => {
    const placed = placeAnchored(
      { top: 10, left: 500, width: 40, height: 20 },
      { width: 100, height: 50 },
      viewport,
      { align: "center", side: "top" },
    );
    expect(placed.left).toBe(470);
    // No room above: it lands below instead.
    expect(placed.side).toBe("bottom");
  });

  it("places to the right and flips left at the edge", () => {
    const right = placeAnchored(
      { top: 100, left: 100, width: 40, height: 20 },
      { width: 100, height: 50 },
      viewport,
      { side: "right" },
    );
    expect(right).toEqual({ top: 100, left: 146, side: "right" });
    const left = placeAnchored(
      { top: 100, left: 940, width: 40, height: 20 },
      { width: 100, height: 50 },
      viewport,
      { side: "right" },
    );
    expect(left.side).toBe("left");
    expect(left.left).toBe(834);
  });
});

describe("placeAtPoint", () => {
  it("opens down and right of the pointer", () => {
    expect(placeAtPoint({ x: 20, y: 30 }, { width: 100, height: 100 }, viewport)).toEqual({
      top: 32,
      left: 20,
      side: "bottom",
    });
  });

  it("flips above the pointer near the bottom", () => {
    const placed = placeAtPoint({ x: 20, y: 590 }, { width: 100, height: 100 }, viewport);
    expect(placed.side).toBe("top");
    expect(placed.top).toBe(488);
  });
});

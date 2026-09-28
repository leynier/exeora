import { describe, expect, it } from "vitest";
import { isMenuAction, menuStep } from "./menu.js";

describe("menuStep", () => {
  it("wraps in both directions", () => {
    expect(menuStep("ArrowDown", 2, 3)).toBe(0);
    expect(menuStep("ArrowUp", 0, 3)).toBe(2);
    expect(menuStep("ArrowUp", -1, 3)).toBe(1);
  });

  it("jumps to the ends", () => {
    expect(menuStep("Home", 2, 3)).toBe(0);
    expect(menuStep("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty menus", () => {
    expect(menuStep("Enter", 0, 3)).toBeUndefined();
    expect(menuStep("ArrowDown", 0, 0)).toBeUndefined();
  });
});

describe("isMenuAction", () => {
  it("tells separators apart", () => {
    expect(isMenuAction({ separator: true })).toBe(false);
    expect(isMenuAction({ label: "Open", onSelect: () => {} })).toBe(true);
  });
});

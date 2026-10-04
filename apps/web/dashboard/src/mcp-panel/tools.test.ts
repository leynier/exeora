import { describe, expect, it, vi } from "vitest";
import { PanelController } from "./controller.js";
import { APP_TOOLS, callAppTool, navigateArgs } from "./tools.js";

describe("navigateArgs", () => {
  it("passes what the schema names, as given", () => {
    expect(
      navigateArgs({ project: "p1", tab: "search", search: { query: "x", regex: true } }),
    ).toEqual({ project: "p1", tab: "search", search: { query: "x", regex: true } });
    expect(navigateArgs({ diff: { path: "src/a.ts" } })).toEqual({ diff: { path: "src/a.ts" } });
    expect(navigateArgs(undefined)).toEqual({});
  });

  it.each([
    [{ file: "a.ts" }, "Unknown field file."],
    [{ path: "" }, "path must be a non-empty path"],
    [{ path: "../etc/passwd" }, "relative to the workspace"],
    [{ path: "/etc/passwd" }, "relative to the workspace"],
    [{ path: "C:\\x" }, "relative to the workspace"],
    [{ project: "" }, "project must be a non-empty string"],
    [{ workspace: "x".repeat(129) }, "at most 128"],
    [{ tab: "admin" }, "tab must be one of"],
    [{ diff: { path: "a", area: "both" } }, "diff.area must be working or staged."],
    [{ diff: { path: "a", extra: 1 } }, "Unknown field diff.extra."],
    [{ search: { query: "x".repeat(1001) } }, "at most 1000"],
    [{ search: { regex: "yes" } }, "search.regex must be true or false."],
    [{ search: { replace: "y" } }, "Unknown field search.replace."],
    [{ path: "a.ts", search: { query: "x" } }, "at most one of path, diff or search"],
    [{ tab: "search", path: "a.ts" }, "opens in the explorer tab, not search"],
    [[], "Arguments must be an object."],
  ])("refuses %j", (args, message) => {
    expect(navigateArgs(args)).toContain(message);
  });
});

describe("callAppTool", () => {
  it("refuses malformed input before asking the gateway", async () => {
    const call = vi.fn();
    const controller = new PanelController(call, 20);
    const answer = await callAppTool(controller, "exeora_workspace_navigate", { path: "", x: 1 });
    expect(answer.isError).toBe(true);
    expect(answer.structuredContent).toMatchObject({ status: "error" });
    expect(call).not.toHaveBeenCalled();
  });

  it("offers exactly the two tools, with strict schemas", () => {
    expect(APP_TOOLS.map((tool) => tool.name)).toEqual([
      "exeora_workspace_get_state",
      "exeora_workspace_navigate",
    ]);
    for (const tool of APP_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});

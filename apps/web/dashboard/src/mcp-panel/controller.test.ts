import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SEARCH, searchStore } from "../components/search/searchStore.js";
import { bufferStore } from "../components/workspace/bufferStore.js";
import type { WorkspaceSnapshot } from "../components/workspace/surface.js";
import { PanelController } from "./controller.js";
import type { CallTool, ToolAnswer } from "./transport.js";

const HERE: WorkspaceSnapshot = {
  projectId: "p1",
  workspace: null,
  targetKey: "main",
  view: "explorer",
  openPaths: ["src/a.ts"],
  active: { kind: "file", path: "src/a.ts" },
};

function answering(...answers: ToolAnswer[]) {
  return vi.fn<CallTool>(async () => answers.shift() ?? { isError: true });
}

function selected(extra: Record<string, unknown> = {}): ToolAnswer {
  return { structuredContent: { projectId: "p1", workspace: null, ...extra } };
}

/** A controller whose Workspace reports what it is told to show, a tick later. */
function following(call: CallTool, settleMs = 200) {
  const controller = new PanelController(call, settleMs);
  controller.report(HERE);
  return controller;
}

afterEach(() => {
  bufferStore.clear("p1", "main", "src/a.ts");
  searchStore.update("p1", "main", EMPTY_SEARCH);
});

describe("PanelController", () => {
  it("is applied once the Workspace shows it, and says what it shows then", async () => {
    const call = answering(selected({ tab: "source", diff: { path: "src/a.ts", area: "staged" } }));
    const controller = following(call);

    const pending = controller.navigate({ diff: { path: "src/a.ts", area: "staged" } });
    await vi.waitFor(() => expect(controller.route().route).not.toBeNull());
    expect(call).toHaveBeenCalledWith("exeora_open_panel", {
      project: "p1",
      diff: { path: "src/a.ts", area: "staged" },
    });
    expect(controller.route().route).toBe(
      "/workspace?project=p1&view=source&detail=diff%3Astaged%3Asrc%2Fa.ts",
    );
    controller.report({
      ...HERE,
      view: "source",
      active: { kind: "diff", area: "staged", path: "src/a.ts" },
    });

    const result = await pending;
    expect(result.status).toBe("applied");
    expect(result.state).toMatchObject({
      tab: "source",
      diff: { path: "src/a.ts", area: "staged" },
    });
  });

  it("says queued when the Workspace has not shown it in time", async () => {
    const controller = following(answering(selected({ tab: "explorer", path: "src/b.ts" })), 20);
    const result = await controller.navigate({ path: "src/b.ts" });
    expect(result.status).toBe("queued");
    expect(result.state.path).toBe("src/a.ts");
  });

  it("keeps the tab on screen when nothing implies another", async () => {
    const call = answering(selected({ workspace: "feat@laptop", tab: "explorer" }));
    const controller = new PanelController(call, 20);
    controller.report({ ...HERE, workspace: "feat@laptop" });
    await controller.navigate({});
    expect(call).toHaveBeenCalledWith("exeora_open_panel", {
      project: "p1",
      workspace: "feat@laptop",
      tab: "explorer",
    });
  });

  it("merges a search into the one on screen", async () => {
    searchStore.update("p1", "main", { query: "old", include: "src/**", regex: true });
    const call = answering(selected({ search: { query: "new", include: "src/**", regex: true } }));
    const controller = following(call, 20);
    await controller.navigate({ search: { query: "new" } });
    expect(call.mock.calls[0]?.[1]).toMatchObject({
      search: { ...EMPTY_SEARCH, query: "new", include: "src/**", regex: true },
    });
    expect(controller.route().route).toContain("view=search&q=new&regex=1&include=src");
  });

  it("asks before leaving unsaved edits, and goes once confirmed", async () => {
    bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
    const controller = following(
      answering({ structuredContent: { projectId: "p2", workspace: null } }),
    );

    const result = await controller.navigate({ project: "p2" });
    expect(result.status).toBe("needs_confirmation");
    expect(result.state.pendingConfirmation).toEqual({
      projectId: "p2",
      workspace: null,
      dirtyPaths: ["src/a.ts"],
    });
    expect(controller.route().route).toBeNull();

    controller.confirm();
    expect(controller.route().route).toBe("/workspace?project=p2");
    expect(controller.state()).toMatchObject({
      pendingConfirmation: null,
      lastConfirmation: "applied",
    });
  });

  it("lets nothing else move the panel, or replace the question, until it is answered", async () => {
    bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
    const call = answering();
    const controller = following(call);
    const first = vi.fn();
    expect(controller.changeTarget({ projectId: "p2", workspace: null }, first)).toBe(
      "needs_confirmation",
    );

    expect(await controller.navigate({ project: "p3" })).toMatchObject({
      status: "needs_confirmation",
      state: { pendingConfirmation: { projectId: "p2" } },
    });
    expect(call).not.toHaveBeenCalled();
    expect(controller.request("/workspace?project=p1&view=search")).toBe("needs_confirmation");
    expect(controller.state().pendingConfirmation?.projectId).toBe("p2");

    controller.cancel();
    expect(first).not.toHaveBeenCalled();
    expect(controller.state().lastConfirmation).toBe("cancelled");
    // Within the same working copy nothing is left behind, so nothing is asked.
    const same = vi.fn();
    expect(controller.changeTarget({ projectId: "p1", workspace: null }, same)).toBe("applied");
    expect(same).toHaveBeenCalledOnce();
  });

  it.each([
    ["another native navigation", (c: PanelController) => void c.navigate({ path: "src/c.ts" })],
    [
      "the person's own picker",
      (c: PanelController) => c.changeTarget({ projectId: "p1", workspace: "w" }, () => {}),
    ],
    [
      "a later host result or deep link",
      (c: PanelController) => c.request("/workspace?project=p1&view=logs"),
    ],
  ])(
    "drops a navigation still being checked when %s moves the panel first",
    async (_, overtake) => {
      let release: (answer: ToolAnswer) => void = () => {};
      const slow = new Promise<ToolAnswer>((resolve) => {
        release = resolve;
      });
      const call = vi
        .fn<CallTool>()
        .mockReturnValueOnce(slow)
        .mockResolvedValue(selected({ path: "src/c.ts", tab: "explorer" }));
      const controller = following(call, 20);

      const first = controller.navigate({ path: "src/old.ts" });
      overtake(controller);
      const before = controller.route();
      release(selected({ path: "src/old.ts", tab: "explorer" }));
      expect((await first).status).toBe("superseded");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(controller.route().route ?? "").not.toContain("old.ts");
      expect(controller.route().version).toBeGreaterThanOrEqual(before.version);
    },
  );

  it("reports a refusal as an error, with the gateway's words", async () => {
    const controller = following(
      answering({ isError: true, content: [{ type: "text", text: "Not a granted project." }] }),
    );
    expect(await controller.navigate({ project: "p9" })).toMatchObject({
      status: "error",
      message: "Not a granted project.",
    });
    expect(controller.route().route).toBeNull();
  });

  it("describes places and names only", () => {
    bufferStore.set("p1", "main", "src/a.ts", { text: "SECRET CONTENT", token: "t" });
    searchStore.update("p1", "main", { query: "needle" });
    const controller = following(answering());
    const state = controller.state();
    expect(state).toEqual({
      projectId: "p1",
      workspace: null,
      tab: "explorer",
      path: "src/a.ts",
      diff: null,
      openPaths: ["src/a.ts"],
      dirtyPaths: ["src/a.ts"],
      search: { ...EMPTY_SEARCH, query: "needle" },
      pendingConfirmation: null,
      lastConfirmation: null,
    });
    expect(JSON.stringify(state)).not.toContain("SECRET");
  });
});

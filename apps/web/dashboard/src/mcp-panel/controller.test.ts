import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SEARCH, searchStore } from "../components/search/searchStore.js";
import { bufferStore } from "../components/workspace/bufferStore.js";
import type { WorkspaceSnapshot } from "../components/workspace/surface.js";
import { PanelController, RESOLVE_NAVIGATION_TOOL } from "./controller.js";
import type { CallTool, ToolAnswer } from "./transport.js";

const HERE: WorkspaceSnapshot = {
  projectId: "p1",
  workspace: null,
  targetKey: "main",
  locations: [
    { slug: "laptop", default: true },
    { slug: "desktop", default: false },
  ],
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
    expect(call).toHaveBeenCalledWith(
      RESOLVE_NAVIGATION_TOOL,
      {
        project: "p1",
        // The root on screen, named: never the connection's saved default.
        workspace: "main",
        diff: { path: "src/a.ts", area: "staged" },
      },
      expect.any(AbortSignal),
    );
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

  it("names the panel to the gateway once it has an address, and asks for nothing else", async () => {
    const call = answering(selected({ tab: "logs" }));
    const controller = new PanelController(call, 20, () => "7d0f2c8e-4a51-4b8e-9b0e-1f2a3b4c5d6e");
    controller.report({ ...HERE, workspace: "feat@laptop" });
    await controller.navigate({ tab: "logs" });
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toBe(RESOLVE_NAVIGATION_TOOL);
    expect(call.mock.calls[0]?.[1]).toEqual({
      panelId: "7d0f2c8e-4a51-4b8e-9b0e-1f2a3b4c5d6e",
      project: "p1",
      workspace: "feat@laptop",
      tab: "logs",
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
    expect(call).toHaveBeenCalledWith(
      RESOLVE_NAVIGATION_TOOL,
      {
        project: "p1",
        workspace: "feat@laptop",
        tab: "explorer",
      },
      expect.any(AbortSignal),
    );
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

  describe("a deadline or a stop", () => {
    /** A gateway that answers whenever told to, signal or not. */
    function slow() {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const call = vi.fn<CallTool>(async () => {
        await gate;
        return selected({ tab: "logs" });
      });
      return { call, release };
    }

    it("never applies an answer that comes after the deadline", async () => {
      const { call, release } = slow();
      const controller = following(call, 20);
      const pending = controller.navigate({ tab: "logs" }, { deadline: Date.now() + 15 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      release();
      expect(await pending).toMatchObject({
        status: "cancelled",
        message: expect.stringContaining("ran out of time"),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(controller.route().route).toBeNull();
      expect(call.mock.calls[0]?.[2]?.aborted).toBe(true);
    });

    it("never applies one stopped while the gateway was checking it", async () => {
      const { call, release } = slow();
      const controller = following(call, 20);
      const stop = new AbortController();
      const pending = controller.navigate({ tab: "logs" }, { signal: stop.signal });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      stop.abort();
      release();
      expect(await pending).toMatchObject({
        status: "cancelled",
        message: expect.stringContaining("stopped"),
      });
      expect(controller.route().route).toBeNull();
    });

    it("asks nothing once the deadline has passed", async () => {
      const call = answering(selected({ tab: "logs" }));
      const controller = following(call, 20);
      const result = await controller.navigate({ tab: "logs" }, { deadline: Date.now() - 1 });
      expect(result.status).toBe("cancelled");
      expect(call).not.toHaveBeenCalled();
    });

    it("waits for the Workspace no longer than the deadline allows", async () => {
      const controller = following(answering(selected({ tab: "logs" })), 5_000);
      const started = Date.now();
      const result = await controller.navigate({ tab: "logs" }, { deadline: Date.now() + 600 });
      expect(result.status).toBe("queued");
      expect(Date.now() - started).toBeLessThan(1_000);
    });
  });

  it("applies nothing the gateway answers after a Stop, and takes back the model's question", async () => {
    let release: (answer: ToolAnswer) => void = () => {};
    const call = vi
      .fn<CallTool>()
      .mockReturnValueOnce(new Promise<ToolAnswer>((resolve) => (release = resolve)))
      .mockResolvedValue({ structuredContent: { projectId: "p2", workspace: null } });
    const controller = following(call, 20);
    const inFlight = controller.navigate({ tab: "logs" });
    controller.stopModel();
    release(selected({ tab: "logs" }));
    expect((await inFlight).status).toBe("superseded");
    expect(controller.route().route).toBeNull();

    // A question the model raised goes with the Stop; one the person raised stays.
    bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
    expect((await controller.navigate({ project: "p2" })).status).toBe("needs_confirmation");
    controller.stopModel();
    expect(controller.state()).toMatchObject({
      pendingConfirmation: null,
      lastConfirmation: "cancelled",
    });
    const proceed = vi.fn();
    controller.changeTarget({ projectId: "p3", workspace: null }, proceed);
    controller.stopModel();
    expect(controller.state().pendingConfirmation?.projectId).toBe("p3");
    controller.cancel();
  });

  describe("when the person leaves the Workspace", () => {
    /** A resolver that answers the first call only once released. */
    function held() {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const call = vi.fn<CallTool>(async () => {
        await gate;
        return selected({ tab: "logs" });
      });
      return { call, release };
    }

    it("describes nothing as shown, and lands no move still being checked", async () => {
      const { call, release } = held();
      const controller = following(call, 20);
      const pending = controller.navigate({ tab: "logs" });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      controller.forget();
      expect(controller.state()).toMatchObject({ projectId: null, tab: null, path: null });
      release();
      expect((await pending).status).toBe("superseded");
      expect(controller.route().route).toBeNull();
    });

    it("lands none either when it goes from one screen without it to another", async () => {
      const { call, release } = held();
      const controller = following(call, 20);
      controller.forget();
      // From Projects, the model asks; the person goes on to Settings.
      const pending = controller.navigate({ project: "p1", tab: "logs" });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      controller.forget();
      release();
      expect((await pending).status).toBe("superseded");
      expect(controller.route().route).toBeNull();
    });

    it("takes back the model's question about unsaved edits, not the person's", async () => {
      bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
      const controller = following(answering({ structuredContent: { projectId: "p2" } }));
      expect((await controller.navigate({ project: "p2" })).status).toBe("needs_confirmation");
      controller.forget();
      expect(controller.state()).toMatchObject({
        pendingConfirmation: null,
        lastConfirmation: "cancelled",
      });

      controller.report(HERE);
      controller.changeTarget({ projectId: "p3", workspace: null }, () => {});
      controller.forget();
      expect(controller.state().pendingConfirmation?.projectId).toBe("p3");
      controller.cancel();
    });
  });

  it("leaves no timer or listener behind for a navigation already too late", async () => {
    vi.useFakeTimers();
    try {
      const call = answering(selected({ tab: "logs" }));
      const controller = following(call, 20);
      const stopped = new AbortController();
      stopped.abort();
      const add = vi.spyOn(stopped.signal, "addEventListener");
      const remove = vi.spyOn(stopped.signal, "removeEventListener");
      const before = vi.getTimerCount();
      expect((await controller.navigate({ tab: "logs" }, { signal: stopped.signal })).status).toBe(
        "cancelled",
      );
      expect(
        (await controller.navigate({ tab: "logs" }, { deadline: Date.now() - 1 })).status,
      ).toBe("cancelled");
      expect(vi.getTimerCount()).toBe(before);
      expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
      expect(call).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

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

  describe("the root of the default location under any of its names", () => {
    it.each([["main"], ["MAIN"], ["main@laptop"], [null]])(
      "applies %j on the root without asking about unsaved edits",
      async (workspace) => {
        bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
        const controller = following(
          answering(selected({ workspace, tab: "explorer", path: "src/b.ts" })),
        );
        const pending = controller.navigate({
          workspace: workspace ?? undefined,
          path: "src/b.ts",
        });
        await vi.waitFor(() => expect(controller.route().route).not.toBeNull());
        expect(controller.state().pendingConfirmation).toBeNull();
        controller.report({
          ...HERE,
          openPaths: ["src/a.ts", "src/b.ts"],
          active: { kind: "file", path: "src/b.ts" },
        });
        expect((await pending).status).toBe("applied");
      },
    );

    it("keeps the search on screen when the gateway spells the root main", async () => {
      searchStore.update("p1", "main", { query: "old", include: "src/**" });
      const call = answering(
        selected({ workspace: "main", tab: "search", search: { query: "new", include: "src/**" } }),
      );
      const controller = following(call, 20);
      await controller.navigate({ workspace: "main", search: { query: "new" } });
      expect(call.mock.calls[0]?.[1]).toMatchObject({
        search: { query: "new", include: "src/**" },
      });
    });

    it("still asks before the root of another location", async () => {
      bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t" });
      const controller = following(
        answering(selected({ workspace: "main@desktop", tab: "explorer" })),
      );
      const result = await controller.navigate({ workspace: "main@desktop" });
      expect(result.status).toBe("needs_confirmation");
      expect(result.state.pendingConfirmation).toMatchObject({ workspace: "main@desktop" });
    });

    it("tells another location's root apart from the default's once both are named", () => {
      const controller = new PanelController(answering(), 20);
      controller.report({ ...HERE, workspace: "main@desktop", targetKey: "main@desktop" });
      bufferStore.set("p1", "main@desktop", "x.ts", { text: "e", token: "t" });
      const proceed = vi.fn();
      expect(controller.changeTarget({ projectId: "p1", workspace: "main@DESKTOP" }, proceed)).toBe(
        "applied",
      );
      expect(controller.changeTarget({ projectId: "p1", workspace: "main" }, proceed)).toBe(
        "needs_confirmation",
      );
      controller.cancel();
      bufferStore.clear("p1", "main@desktop", "x.ts");
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { configureWorkspaceScope } from "../workspace/scope.js";
import {
  EMPTY_SEARCH,
  searchFromParams,
  searchStore,
  searchToParams,
  withoutSearchParams,
} from "./searchStore.js";

afterEach(() => configureWorkspaceScope(""));

describe("searchStore", () => {
  it("merges a change into what is there and tells its listeners", () => {
    const listener = vi.fn();
    const stop = searchStore.subscribe("p1", "main", listener);
    searchStore.update("p1", "main", { query: "answer", regex: true });
    searchStore.update("p1", "main", { include: "src/**" });
    expect(searchStore.get("p1", "main")).toEqual({
      ...EMPTY_SEARCH,
      query: "answer",
      regex: true,
      include: "src/**",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    searchStore.update("p1", "main", { query: "answer" });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    searchStore.update("p1", "main", EMPTY_SEARCH);
  });

  it("keeps working copies and panels apart", () => {
    searchStore.update("p1", "w1", { query: "one" });
    expect(searchStore.get("p1", "main")).toEqual(EMPTY_SEARCH);
    configureWorkspaceScope("panel-b");
    expect(searchStore.get("p1", "w1")).toEqual(EMPTY_SEARCH);
    configureWorkspaceScope("");
    expect(searchStore.get("p1", "w1").query).toBe("one");
    searchStore.update("p1", "w1", EMPTY_SEARCH);
  });
});

describe("search in the address", () => {
  it("round-trips a search, switches and filters included", () => {
    const params = new URLSearchParams({ project: "p1", view: "search" });
    const search = {
      query: "answer",
      regex: true,
      caseSensitive: false,
      wholeWord: true,
      include: "src/**",
      exclude: "",
      includeIgnored: true,
    };
    searchToParams(search, params);
    expect(params.toString()).toBe(
      "project=p1&view=search&q=answer&regex=1&word=1&include=src%2F**&ignored=1",
    );
    expect(searchFromParams(params)).toEqual(search);
    expect(withoutSearchParams(params).toString()).toBe("project=p1&view=search");
  });

  it("takes an empty query as a search that clears, and no q as none", () => {
    const params = new URLSearchParams();
    searchToParams(EMPTY_SEARCH, params);
    expect(params.toString()).toBe("q=");
    expect(searchFromParams(params)).toEqual(EMPTY_SEARCH);
    expect(searchFromParams(new URLSearchParams("view=search"))).toBeNull();
  });
});

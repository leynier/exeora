import { describe, expect, it } from "vitest";
import { ensureStorage, memoryStorage } from "./sandbox.js";

describe("memoryStorage", () => {
  it("behaves like Storage", () => {
    const store = memoryStorage();
    store.setItem("a", "1");
    store.setItem("b", "2");
    expect(store.getItem("a")).toBe("1");
    expect(store.length).toBe(2);
    expect(store.key(1)).toBe("b");
    store.removeItem("a");
    expect(store.getItem("a")).toBeNull();
    store.clear();
    expect(store.length).toBe(0);
  });
});

describe("ensureStorage", () => {
  it("replaces storage that throws on touch", () => {
    const win = {} as Window & typeof globalThis;
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The document is sandboxed", "SecurityError");
      },
    });
    Object.defineProperty(win, "sessionStorage", { configurable: true, value: memoryStorage() });
    const session = win.sessionStorage;
    ensureStorage(win);
    win.localStorage.setItem("k", "v");
    expect(win.localStorage.getItem("k")).toBe("v");
    expect(win.sessionStorage).toBe(session);
  });
});

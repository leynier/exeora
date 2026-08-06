import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeviceView, ProjectView } from "./api.js";
import { decideDevice, projectIsCurrent, projectRoot, slugify, uniqueSlug } from "./onboard.js";

/**
 * The decisions `connect` makes on its own.
 *
 * Now that one command signs in, registers the machine and registers the
 * directory, those choices happen without anyone watching. These cover the
 * three that are wrong in a way nobody would notice until it mattered: coming
 * back from a revocation, taking a slug that already points somewhere else,
 * and handing an agent a directory far larger than intended.
 */

const device = (over: Partial<DeviceView> = {}): DeviceView => ({
  id: "dev_1",
  name: "minipc",
  platform: "linux",
  cliVersion: "0.2.0",
  lastSeenAt: null,
  revokedAt: null,
  ...over,
});

const project = (over: Partial<ProjectView> = {}): ProjectView => ({
  id: "prj_1",
  slug: "api",
  name: "api",
  deviceId: "dev_1",
  localPath: "/home/someone/work/api",
  mcpUrl: "https://exeora.dev/p/prj_1/mcp",
  createdAt: 0,
  ...over,
});

describe("deciding what to do about this machine", () => {
  it("uses the stored machine when the gateway still has it", () => {
    expect(decideDevice("dev_1", [device()])).toEqual({ kind: "use", id: "dev_1", name: "minipc" });
  });

  it("registers when nothing is stored", () => {
    expect(decideDevice(undefined, [device()])).toEqual({ kind: "register" });
  });

  it("registers when the stored machine is unknown to this gateway", () => {
    // A different account, or a database that no longer has the row. Neither
    // is a revocation, so coming back is right here.
    expect(decideDevice("dev_gone", [device()])).toEqual({ kind: "register" });
  });

  it("refuses to re-register a machine that was revoked", () => {
    // The one that must not become `register`: revoking from the dashboard is
    // the stop button, and a stop button that undoes itself on the next run is
    // not a stop button.
    expect(decideDevice("dev_1", [device({ revokedAt: Date.now() })])).toEqual({
      kind: "revoked",
      name: "minipc",
    });
  });

  it("keeps machines apart rather than matching on name", () => {
    const devices = [device({ id: "dev_a" }), device({ id: "dev_b" })];
    expect(decideDevice("dev_b", devices)).toMatchObject({ kind: "use", id: "dev_b" });
  });
});

describe("choosing a slug", () => {
  it("uses the directory name when it is free", () => {
    expect(uniqueSlug("api", "/work/api", [])).toBe("api");
  });

  it("keeps the slug it already has for this directory", () => {
    // Re-running `connect` in the same place must not drift to `api-2`.
    const remote = [project({ slug: "api", localPath: "/work/api" })];
    expect(uniqueSlug("api", "/work/api", remote)).toBe("api");
  });

  it("steps aside when another directory holds the slug", () => {
    // Taking it would repoint the existing project's MCP URL at this
    // directory, which is data loss dressed up as a convenience.
    const remote = [project({ slug: "api", localPath: "/elsewhere/api" })];
    expect(uniqueSlug("api", "/work/api", remote)).toBe("api-2");
  });

  it("keeps counting past the first collision", () => {
    const remote = [
      project({ id: "a", slug: "api", localPath: "/one/api" }),
      project({ id: "b", slug: "api-2", localPath: "/two/api" }),
      project({ id: "c", slug: "api-3", localPath: "/three/api" }),
    ];
    expect(uniqueSlug("api", "/four/api", remote)).toBe("api-4");
  });

  it("normalises a directory name into something a URL can carry", () => {
    expect(slugify("My Project!")).toBe("my-project");
    expect(slugify("--weird--")).toBe("weird");
    expect(slugify("...")).toBe("project");
  });
});

describe("deciding whether the gateway's project record is current", () => {
  const local = { id: "prj_1", slug: "api", name: "api", root: "/work/api" };

  it("is current when the record points at this machine and this path", () => {
    const remote = [project({ id: "prj_1", deviceId: "dev_1", localPath: "/work/api" })];
    expect(projectIsCurrent(local, remote, "dev_1", "/work/api")).toBe(true);
  });

  it("is not current when the record points at another machine", () => {
    // What `--reset` leaves behind, and the reason it needed fixing: the
    // project still resolves, but the relay it names is the revoked one, so
    // every tool call comes back offline.
    const remote = [project({ id: "prj_1", deviceId: "dev_old", localPath: "/work/api" })];
    expect(projectIsCurrent(local, remote, "dev_new", "/work/api")).toBe(false);
  });

  it("is not current when the directory has moved", () => {
    const remote = [project({ id: "prj_1", deviceId: "dev_1", localPath: "/old/api" })];
    expect(projectIsCurrent(local, remote, "dev_1", "/work/api")).toBe(false);
  });

  it("is not current when the gateway no longer has the project", () => {
    expect(projectIsCurrent(local, [], "dev_1", "/work/api")).toBe(false);
  });
});

describe("choosing a directory", () => {
  it("resolves a relative path against the working directory", () => {
    expect(projectRoot(".")).toBe(resolve("."));
    expect(projectRoot(undefined)).toBe(resolve("."));
  });

  it("refuses the home directory", () => {
    // A project is the boundary every tool is confined to, so this one would
    // hand over the whole account.
    expect(() => projectRoot(homedir())).toThrow(/home directory/);
  });

  it("refuses the filesystem root", () => {
    expect(() => projectRoot(parse(resolve(".")).root)).toThrow(/filesystem root/);
  });

  it("allows a directory inside home, which is where projects live", () => {
    expect(projectRoot(`${homedir()}/work/api`)).toBe(resolve(homedir(), "work/api"));
  });
});

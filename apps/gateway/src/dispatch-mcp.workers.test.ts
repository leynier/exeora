import { describe, expect, it } from "vitest";
import { descriptorFromCatalog } from "./dispatch-mcp.js";

/**
 * A proxied tool is described by the machine that runs it. On a cloud
 * workspace that is not the project's machine, so the descriptor the caller
 * resolved is looked up again in the target's catalog before the policy
 * reads its hint.
 */

const tool = (name: string, readOnlyHint: boolean) => ({
  exposedName: `files_${name}`,
  server: "files",
  name,
  inputSchema: {},
  annotations: { readOnlyHint },
});

describe("descriptorFromCatalog", () => {
  it("finds the same upstream tool by server and name, with that machine's hint", () => {
    const catalogs = { prj_one: [tool("write", false), tool("read", true)] };
    expect(
      descriptorFromCatalog(catalogs, "prj_one", { server: "files", name: "write" }),
    ).toMatchObject({
      annotations: { readOnlyHint: false },
    });
    expect(
      descriptorFromCatalog(catalogs, "prj_one", { server: "other", name: "write" }),
    ).toBeUndefined();
    expect(
      descriptorFromCatalog(catalogs, "prj_two", { server: "files", name: "write" }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { installers } from "./installers.js";

describe("public installers", () => {
  it.each([
    ["/linux/install.sh", "#!/usr/bin/env sh", "text/x-shellscript"],
    ["/macos/install.sh", "#!/usr/bin/env sh", "text/x-shellscript"],
    ["/windows/install.ps1", '$ErrorActionPreference = "Stop"', "text/plain"],
  ])("serves %s directly", async (path, opening, contentType) => {
    const response = await installers.request(`https://exeora.dev${path}`);

    expect(response.status).toBe(200);
    expect(response.redirected).toBe(false);
    expect(response.headers.get("content-type")).toContain(contentType);
    expect(await response.text()).toContain(opening);
  });
});

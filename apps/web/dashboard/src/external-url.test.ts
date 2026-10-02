import { describe, expect, it } from "vitest";
import { externalHttpsUrl } from "./external-url.js";

describe("externalHttpsUrl", () => {
  it("keeps absolute HTTPS integration links", () => {
    expect(externalHttpsUrl("https://ci.example/check/42?run=1")).toBe(
      "https://ci.example/check/42?run=1",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/x",
    "relative/path",
    null,
    "",
  ])("rejects unsafe URL %s", (value) => {
    expect(externalHttpsUrl(value)).toBeUndefined();
  });
});

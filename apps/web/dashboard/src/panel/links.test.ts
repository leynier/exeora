import { describe, expect, it } from "vitest";
import { isInPageLink } from "./links.js";

const HERE = "https://exeora.dev/dashboard/panel";

describe("isInPageLink", () => {
  it.each(["#install", `${HERE}#install`])("keeps %s in the page", (href) => {
    expect(isInPageLink(href, HERE)).toBe(true);
  });

  it.each([
    "https://github.com/leynier/exeora#readme",
    "/dashboard/#install",
    "?tab=1#install",
    HERE,
    "not a url at all://",
  ])("sends %s elsewhere", (href) => {
    expect(isInPageLink(href, HERE)).toBe(false);
  });
});

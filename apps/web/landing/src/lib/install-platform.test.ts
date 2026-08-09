import { describe, expect, it } from "vitest";
import { detectInstallPlatform } from "./install-platform.js";

describe("install platform detection", () => {
  it.each([
    ["macOS", "macos"],
    ["Windows", "windows"],
    ["Linux", "linux"],
  ] as const)("uses the modern %s platform signal", (platform, expected) => {
    expect(detectInstallPlatform({ userAgentDataPlatform: platform })).toBe(expected);
  });

  it.each([
    ["MacIntel", "macos"],
    ["Win32", "windows"],
    ["Linux x86_64", "linux"],
  ] as const)("falls back from the legacy %s signal", (platform, expected) => {
    expect(detectInstallPlatform({ legacyPlatform: platform })).toBe(expected);
  });

  it("falls back to the user agent when platform signals are unavailable", () => {
    expect(
      detectInstallPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe("windows");
  });

  it.each(["Android", "iPhone", "iPad", "Mobile"])(
    "does not present a desktop installer as native on %s",
    (mobilePlatform) => {
      expect(
        detectInstallPlatform({
          legacyPlatform: "Linux armv8l",
          userAgent: `Mozilla/5.0 (${mobilePlatform}) Mobile`,
        }),
      ).toBeNull();
    },
  );

  it("leaves the server order intact when the platform is unknown", () => {
    expect(detectInstallPlatform({ userAgent: "unknown" })).toBeNull();
  });
});

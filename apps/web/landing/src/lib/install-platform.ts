export type InstallPlatform = "macos" | "linux" | "windows";
export type InstallPlatformPreference = InstallPlatform | "mobile";

interface BrowserPlatformSignals {
  userAgentDataPlatform?: string;
  legacyPlatform?: string;
  userAgent?: string;
}

/** Pick a supported desktop platform from the signals browsers expose. */
export function detectInstallPlatform({
  userAgentDataPlatform = "",
  legacyPlatform = "",
  userAgent = "",
}: BrowserPlatformSignals): InstallPlatformPreference | null {
  if (
    /android|iphone|ipad|ipod|mobile/i.test(
      `${userAgentDataPlatform} ${legacyPlatform} ${userAgent}`,
    )
  ) {
    return "mobile";
  }

  const platform = userAgentDataPlatform || legacyPlatform || userAgent;
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  if (/linux/i.test(platform)) return "linux";
  return null;
}

/**
 * Reads the claims out of a JWT without checking its signature.
 *
 * The token was just handed over by the provider on a channel the gateway
 * trusts. Claims only provide account routing and renewal schedules; they
 * never authenticate an Exeora user. The provider checks the access token.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(payload));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A string claim, or undefined for a claim that is absent or not a string. */
export function stringClaim(
  claims: Record<string, unknown> | null,
  ...path: string[]
): string | undefined {
  let value: unknown = claims;
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Expiry metadata for renewal, never an authentication decision. */
export function tokenExpiresAt(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 && exp <= 8_640_000_000_000
    ? exp * 1000
    : undefined;
}

function base64UrlDecode(text: string): string {
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

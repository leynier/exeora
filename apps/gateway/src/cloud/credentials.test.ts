import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./credentials.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("repository credentials at rest", () => {
  it("round-trips a secret and never stores it in the clear", async () => {
    const sealed = await encryptSecret(KEY, "ghp_secret_token");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("ghp_secret");
    await expect(decryptSecret(KEY, sealed)).resolves.toBe("ghp_secret_token");
  });

  it("uses a fresh nonce every time", async () => {
    expect(await encryptSecret(KEY, "same")).not.toBe(await encryptSecret(KEY, "same"));
  });

  it("refuses the wrong key, a mangled value and a malformed key", async () => {
    const sealed = await encryptSecret(KEY, "token");
    const other = KEY.replace(/^0/, "f");
    await expect(decryptSecret(other, sealed)).rejects.toThrow();
    await expect(decryptSecret(KEY, "v2.a.b")).rejects.toThrow("not in a form");
    await expect(encryptSecret("short", "token")).rejects.toThrow("64 hex");
  });
});

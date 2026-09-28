import { describe, expect, it } from "vitest";
import { decodeJwtPayload, stringClaim } from "./jwt.js";

function unsigned(claims: unknown): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replaceAll("=", "");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

describe("decodeJwtPayload", () => {
  it("reads the claims without checking the signature", () => {
    const token = unsigned({
      email: "person@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" },
    });
    const claims = decodeJwtPayload(token);
    expect(claims?.email).toBe("person@example.com");
    expect(stringClaim(claims, "https://api.openai.com/auth", "chatgpt_account_id")).toBe("acct_1");
    expect(stringClaim(claims, "email")).toBe("person@example.com");
  });

  it("answers null for anything that is not a JWT with an object payload", () => {
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
    expect(decodeJwtPayload("a.!!!.c")).toBeNull();
    expect(decodeJwtPayload(`x.${Buffer.from("[1]").toString("base64url")}.y`)).toBeNull();
    expect(decodeJwtPayload(`x.${Buffer.from("null").toString("base64url")}.y`)).toBeNull();
  });

  it("answers undefined for a claim that is missing, empty or not a string", () => {
    const claims = decodeJwtPayload(unsigned({ empty: "", n: 4, nested: { deep: "ok" } }));
    expect(stringClaim(claims, "empty")).toBeUndefined();
    expect(stringClaim(claims, "n")).toBeUndefined();
    expect(stringClaim(claims, "missing", "deeper")).toBeUndefined();
    expect(stringClaim(claims, "nested", "deep")).toBe("ok");
    expect(stringClaim(null, "email")).toBeUndefined();
  });
});

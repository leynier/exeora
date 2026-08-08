import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clearSession, getSessionUserId, setSession } from "./session.js";

/** Only the bindings the session helpers actually read. */
const env = {
  COOKIE_SECRET: "test-secret-value",
  EXEORA_BASE_URL: "http://localhost:8787",
} as unknown as Env;

/** Minimal app exposing the three session operations over HTTP. */
const app = new Hono<{ Bindings: Env }>()
  .get("/set/:userId", async (c) => {
    await setSession(c, c.req.param("userId"));
    return c.text("ok");
  })
  .get("/who", async (c) => c.text((await getSessionUserId(c)) ?? "anonymous"))
  .get("/clear", (c) => {
    clearSession(c);
    return c.text("ok");
  });

function cookieFrom(response: Response): string {
  // biome-ignore lint/style/noNonNullAssertion: the route always sets one
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function who(cookie: string): Promise<string> {
  const response = await app.request("/who", { headers: { cookie } }, env);
  return response.text();
}

describe("session cookie", () => {
  it("round-trips the user id", async () => {
    const cookie = cookieFrom(await app.request("/set/usr_abc", {}, env));
    expect(await who(cookie)).toBe("usr_abc");
  });

  it("reports anonymous with no cookie", async () => {
    expect(await who("")).toBe("anonymous");
  });

  it("rejects a cookie whose user id was swapped but signature kept", async () => {
    const cookie = cookieFrom(await app.request("/set/usr_abc", {}, env));
    const forged = cookie.replace("usr_abc", "usr_victim");
    expect(await who(forged)).toBe("anonymous");
  });

  it("rejects an unsigned cookie", async () => {
    expect(await who("exeora_session=usr_abc")).toBe("anonymous");
  });

  it("rejects a cookie signed with a different secret", async () => {
    const other = { ...env, COOKIE_SECRET: "a-different-secret" } as Env;
    const cookie = cookieFrom(await app.request("/set/usr_abc", {}, other));
    expect(await who(cookie)).toBe("anonymous");
  });

  it("does not confuse a user id that itself contains a dot", async () => {
    const cookie = cookieFrom(await app.request("/set/usr.with.dots", {}, env));
    expect(await who(cookie)).toBe("usr.with.dots");
  });

  it("omits Secure over http so a localhost login is not silently dropped", async () => {
    const header = (await app.request("/set/usr_abc", {}, env)).headers.get("set-cookie") ?? "";
    expect(header).not.toMatch(/Secure/i);
  });

  it("sets Secure when the configured base URL is https", async () => {
    const prod = { ...env, EXEORA_BASE_URL: "https://exeora.dev" } as Env;
    const header = (await app.request("/set/usr_abc", {}, prod)).headers.get("set-cookie") ?? "";
    expect(header).toMatch(/Secure/i);
  });

  it("expires the cookie on clear", async () => {
    const response = await app.request("/clear", {}, env);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("marks the cookie HttpOnly and SameSite=Lax", async () => {
    // HttpOnly keeps it away from scripts; Lax is required because the return
    // from an identity provider is a cross-site navigation that Strict would drop.
    const header = (await app.request("/set/usr_abc", {}, env)).headers.get("set-cookie") ?? "";
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });
});

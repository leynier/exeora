import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clearSession, getSessionUserId, setSession } from "./session.js";

const env = { COOKIE_SECRET: "test-secret-value" } as Env;

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
    const other = { COOKIE_SECRET: "a-different-secret" } as Env;
    const cookie = cookieFrom(await app.request("/set/usr_abc", {}, other));
    expect(await who(cookie)).toBe("anonymous");
  });

  it("does not confuse a user id that itself contains a dot", async () => {
    const cookie = cookieFrom(await app.request("/set/usr.with.dots", {}, env));
    expect(await who(cookie)).toBe("usr.with.dots");
  });

  it("expires the cookie on clear", async () => {
    const response = await app.request("/clear", {}, env);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("marks the cookie HttpOnly and SameSite=Lax", async () => {
    // HttpOnly keeps it away from scripts; Lax is required because the return
    // from GitHub is a cross-site top-level navigation that Strict would drop.
    const header = (await app.request("/set/usr_abc", {}, env)).headers.get("set-cookie") ?? "";
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });
});

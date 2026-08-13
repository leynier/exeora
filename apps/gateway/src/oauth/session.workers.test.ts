import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { clearSession, getSessionUserId, setSession } from "./session.js";

const USER = "usr_session";
const bindings = {
  ...env,
  COOKIE_SECRET: "test-secret-value",
  EXEORA_BASE_URL: "http://localhost:8787",
} as unknown as Env;

const app = new Hono<{ Bindings: Env }>()
  .get("/set", async (c) => {
    await setSession(c, USER);
    return c.text("ok");
  })
  .get("/who", async (c) => c.text((await getSessionUserId(c)) ?? "anonymous"))
  .get("/clear", async (c) => {
    await clearSession(c);
    return c.text("ok");
  });

beforeEach(async () => {
  await db(env)
    .insert(schema.users)
    .values({ id: USER, email: "session@example.com" })
    .onConflictDoNothing()
    .run();
});

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("route did not set a cookie");
  return header.split(";")[0] ?? "";
}

async function createCookie(custom = bindings): Promise<string> {
  return cookieFrom(await app.request("/set", {}, custom));
}

async function who(cookie: string): Promise<string> {
  return (await app.request("/who", { headers: { cookie } }, bindings)).text();
}

describe("revocable browser session", () => {
  it("round-trips the user id", async () => {
    expect(await who(await createCookie())).toBe(USER);
  });

  it("rejects missing and forged opaque values", async () => {
    expect(await who("")).toBe("anonymous");
    expect(await who("exeora_session=v2.forged")).toBe("anonymous");
    expect(await who("exeora_session=usr_legacy.signature")).toBe("anonymous");
  });

  it("rejects an expired session even when the browser still sends it", async () => {
    const cookie = await createCookie();
    await db(env)
      .update(schema.browserSessions)
      .set({ expiresAt: new Date(0) })
      .run();
    expect(await who(cookie)).toBe("anonymous");
  });

  it("revokes the server row on logout and expires the cookie", async () => {
    const cookie = await createCookie();
    const response = await app.request("/clear", { headers: { cookie } }, bindings);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(await who(cookie)).toBe("anonymous");

    const rows = await db(env)
      .select({ revokedAt: schema.browserSessions.revokedAt })
      .from(schema.browserSessions)
      .all();
    expect(rows.some((row) => row.revokedAt instanceof Date)).toBe(true);
  });

  it("cascades sessions when the account is deleted", async () => {
    const cookie = await createCookie();
    await db(env).delete(schema.users).where(eq(schema.users.id, USER)).run();
    expect(await who(cookie)).toBe("anonymous");
    expect(await db(env).select().from(schema.browserSessions).all()).toEqual([]);
  });

  it("sets HttpOnly, SameSite and environment-appropriate Secure", async () => {
    const local = (await app.request("/set", {}, bindings)).headers.get("set-cookie") ?? "";
    expect(local).toMatch(/HttpOnly/i);
    expect(local).toMatch(/SameSite=Lax/i);
    expect(local).not.toMatch(/Secure/i);

    const production = {
      ...bindings,
      EXEORA_BASE_URL: "https://exeora.dev",
    } as Env;
    const secure = (await app.request("/set", {}, production)).headers.get("set-cookie") ?? "";
    expect(secure).toMatch(/Secure/i);
  });
});

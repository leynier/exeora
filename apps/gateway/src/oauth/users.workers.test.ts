import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { maybeBootstrapAdmin, parseAdminEmails, resolveUser } from "./users.js";

/**
 * Registration-time admin bootstrap.
 *
 * A fresh install has no seed row. Either the first account to register is
 * promoted, or only the addresses named in ADMIN_EMAILS are.
 */

const FIRST = {
  providerUserId: "gh_first",
  email: "first@example.com",
  name: "First",
  avatarUrl: null as string | null,
};

const SECOND = {
  providerUserId: "gh_second",
  email: "second@example.com",
  name: "Second",
  avatarUrl: null as string | null,
};

const LISTED = {
  providerUserId: "gh_listed",
  email: "ops@example.com",
  name: "Ops",
  avatarUrl: null as string | null,
};

async function isAdmin(email: string): Promise<boolean> {
  const row = await db(env)
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.toLowerCase()))
    .get();
  return row !== undefined;
}

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.oauthIdentities).run();
  await database.delete(schema.users).run();
  await database.delete(schema.adminUsers).run();
});

describe("parseAdminEmails", () => {
  it("returns nothing for an unset or empty binding", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails("  ,  , ")).toEqual([]);
  });

  it("trims, lower-cases and drops empties", () => {
    expect(parseAdminEmails(" Ops@Example.com, other@x.dev , ")).toEqual([
      "ops@example.com",
      "other@x.dev",
    ]);
  });
});

describe("first-user bootstrap", () => {
  it("promotes the first account to register", async () => {
    await resolveUser(db(env), "github", FIRST);
    expect(await isAdmin(FIRST.email)).toBe(true);
  });

  it("leaves a second account ordinary", async () => {
    await resolveUser(db(env), "github", FIRST);
    await resolveUser(db(env), "github", SECOND);
    expect(await isAdmin(FIRST.email)).toBe(true);
    expect(await isAdmin(SECOND.email)).toBe(false);
  });

  it("does not promote on a later sign-in of an existing user", async () => {
    await resolveUser(db(env), "github", FIRST);
    await db(env).delete(schema.adminUsers).run();
    await resolveUser(db(env), "github", FIRST);
    expect(await isAdmin(FIRST.email)).toBe(false);
  });
});

describe("ADMIN_EMAILS allow-list", () => {
  it("promotes only a listed address", async () => {
    await resolveUser(db(env), "github", FIRST, "ops@example.com");
    await resolveUser(db(env), "github", LISTED, "ops@example.com");
    expect(await isAdmin(FIRST.email)).toBe(false);
    expect(await isAdmin(LISTED.email)).toBe(true);
  });

  it("matches the list case-insensitively", async () => {
    await resolveUser(db(env), "github", LISTED, "OPS@EXAMPLE.COM");
    expect(await isAdmin(LISTED.email)).toBe(true);
  });

  it("still promotes a listed address when another admin already exists", async () => {
    await maybeBootstrapAdmin(db(env), "already@example.com", "already@example.com");
    await resolveUser(db(env), "github", LISTED, "ops@example.com,already@example.com");
    expect(await isAdmin(LISTED.email)).toBe(true);
  });
});

describe("identity linking", () => {
  it("links Google to the existing GitHub account by verified email", async () => {
    const githubUser = await resolveUser(db(env), "github", FIRST);
    const googleUser = await resolveUser(db(env), "google", {
      ...FIRST,
      providerUserId: "google_first",
      email: "FIRST@example.com",
    });

    expect(googleUser.id).toBe(githubUser.id);
    const identities = await db(env)
      .select({ provider: schema.oauthIdentities.provider })
      .from(schema.oauthIdentities)
      .where(eq(schema.oauthIdentities.userId, githubUser.id));
    expect(identities.map(({ provider }) => provider).sort()).toEqual(["github", "google"]);
  });

  it("keeps different verified emails as different accounts", async () => {
    const githubUser = await resolveUser(db(env), "github", FIRST);
    const googleUser = await resolveUser(db(env), "google", {
      ...SECOND,
      providerUserId: "google_second",
    });

    expect(googleUser.id).not.toBe(githubUser.id);
  });

  it("fails closed when an email already belongs to multiple accounts", async () => {
    const database = db(env);
    await database
      .insert(schema.users)
      .values([
        { id: "usr_duplicate_1", email: "duplicate@example.com" },
        { id: "usr_duplicate_2", email: "DUPLICATE@example.com" },
      ])
      .run();

    await expect(
      resolveUser(database, "google", {
        providerUserId: "google_duplicate",
        email: "duplicate@example.com",
        name: "Duplicate",
        avatarUrl: null,
      }),
    ).rejects.toThrow("more than one Exeora account");
  });
});

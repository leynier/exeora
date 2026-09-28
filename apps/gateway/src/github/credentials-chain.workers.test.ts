import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { accessCacheKey } from "./access.js";
import { GitHubError } from "./app.js";
import { projectCredential } from "./credentials.js";
import {
  type Asked,
  authorize,
  envOn,
  githubWorld,
  isTokenRequest,
  minted,
  repository,
  tokenOf,
} from "./fixtures.js";

/**
 * What git's token is asked for, and what is asked next when GitHub says no.
 *
 * The app asks for more than it did, and an installation holds the addition
 * only once its owner accepted it. Until then GitHub answers 422 to a token
 * that names it, and the machine has to be given what it was given before.
 */

const USER = "usr_github_chain";
const INSTALLATION = 9301;
const PROJECT = "prj_chain_api";
const REPO = 61;

const FULL = { contents: "write", metadata: "read", pull_requests: "write", workflows: "write" };
const LEGACY_FULL = { contents: "write", metadata: "read", pull_requests: "write" };
const REDUCED = { contents: "write", metadata: "read" };
const READ_ONLY = { contents: "read", metadata: "read" };

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await env.OAUTH_KV.delete(accessCacheKey(USER, REPO));
  await database.insert(schema.users).values({ id: USER, email: "github-chain@example.com" }).run();
  await database
    .insert(schema.devices)
    .values({ id: "dev_chain_laptop", userId: USER, name: "laptop", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: USER,
      deviceId: "dev_chain_laptop",
      name: "api",
      slug: "api",
      localPath: "/w/api",
      repoUrl: "https://github.com/acme/api.git",
      repoKey: "github.com/acme/api",
    })
    .run();
  await database
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_chain",
      userId: USER,
      installationId: INSTALLATION,
      accountLogin: "acme",
      accountType: "Organization",
    })
    .run();
  await database
    .insert(schema.githubRepositories)
    .values({
      projectId: PROJECT,
      userId: USER,
      installationId: INSTALLATION,
      repoId: REPO,
      fullName: "acme/api",
      private: true,
    })
    .run();
  await authorize(USER);
});

/** A GitHub where the person may push, or only read, and tokens are answered by `first`. */
function github(first: (asked: Asked) => Response | undefined, push = true) {
  return githubWorld(
    {
      installations: { [INSTALLATION]: [repository(REPO, "acme/api", { private: true })] },
      people: { [tokenOf(USER)]: { [REPO]: { push } } },
    },
    first,
  );
}

const asking = (request: Asked) =>
  (request.body as { permissions: Record<string, string> }).permissions;

/** An installation that refuses every token naming one of `missing`, and grants the rest. */
const without = (missing: string[], token: string) => (request: Asked) => {
  if (!isTokenRequest(request)) return undefined;
  return missing.some((name) => asking(request)[name])
    ? Response.json({ message: "The permissions requested are not granted" }, { status: 422 })
    : minted(token);
};

const asked = (fake: { asked: Asked[] }) =>
  fake.asked.filter((request) => isTokenRequest(request)).map(asking);

describe("what git's token is asked for", () => {
  it("is everything git needs, asked once, of an installation that accepted it", async () => {
    const fake = github(without([], "ghs_full"));
    const credential = await projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    expect(credential).toMatchObject({ password: "ghs_full", username: "x-access-token" });
    // Of what the app asks, git is given workflows and nothing else new.
    expect(asked(fake)).toEqual([FULL]);
  });

  it("is what it was before for an installation that has not accepted workflows", async () => {
    const fake = github(without(["workflows"], "ghs_legacy"));
    const credential = await projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    expect(credential).toMatchObject({ password: "ghs_legacy" });
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL]);
  });

  it("is less again for one that was never given pull requests", async () => {
    const fake = github(without(["workflows", "pull_requests"], "ghs_reduced"));
    const credential = await projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    expect(credential).toMatchObject({ password: "ghs_reduced" });
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL, REDUCED]);
  });

  it("stops at the end of the chain when GitHub refuses all of it", async () => {
    const fake = github((request) =>
      isTokenRequest(request) ? Response.json({}, { status: 422 }) : undefined,
    );
    const failed = projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    await expect(failed).rejects.toMatchObject({ name: "GitHubError", status: 422 });
    // Each once, in order, and never the first again.
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL, REDUCED]);
  });

  it("asks for nothing less after a failure that is not about permissions", async () => {
    for (const status of [401, 403, 404, 500]) {
      const fake = github((request) =>
        isTokenRequest(request) ? Response.json({}, { status }) : undefined,
      );
      const failed = projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
      await expect(failed).rejects.toBeInstanceOf(GitHubError);
      expect(asked(fake), String(status)).toEqual([FULL]);
    }

    // Nor when it is the second of the chain that fails for another reason.
    const fake = github((request) =>
      isTokenRequest(request)
        ? Response.json({}, { status: asking(request).workflows ? 422 : 500 })
        : undefined,
    );
    const failed = projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    await expect(failed).rejects.toMatchObject({ status: 500 });
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL]);
  });

  it("never keeps a refusal as if it were a token", async () => {
    let accepted = false;
    const fake = github((request) =>
      accepted ? undefined : without(["workflows"], "ghs_legacy")(request),
    );
    // One gateway throughout, so what it remembers is part of what is tested.
    const gateway = await envOn();
    const credential = () => projectCredential(gateway, USER, PROJECT, fake.fetcher);

    expect(await credential()).toMatchObject({ password: "ghs_legacy" });
    expect(await credential()).toMatchObject({ password: "ghs_legacy" });
    // The narrower token was kept and the refusal was not: the wider one is
    // asked for again, which is all the second fetch cost.
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL, FULL]);

    // The owner accepts, and the next fetch is given everything.
    accepted = true;
    const wider = await credential();
    expect(wider?.password).toMatch(new RegExp(`^ghs_${INSTALLATION}_`));
    expect(asked(fake)).toEqual([FULL, LEGACY_FULL, FULL, FULL]);
    // Which is then the token that is kept.
    expect(await credential()).toEqual(wider);
    expect(asked(fake)).toHaveLength(4);
  });

  it("is reading only for a person who may not push, whatever was accepted", async () => {
    const fake = github(without([], "ghs_read"), false);
    const credential = await projectCredential(await envOn(), USER, PROJECT, fake.fetcher);
    expect(credential).toMatchObject({ password: "ghs_read" });
    expect(asked(fake)).toEqual([READ_ONLY]);

    // And a refusal of that much is not answered by asking for more.
    const refusing = github(
      (request) => (isTokenRequest(request) ? Response.json({}, { status: 422 }) : undefined),
      false,
    );
    await env.OAUTH_KV.delete(accessCacheKey(USER, REPO));
    const failed = projectCredential(await envOn(), USER, PROJECT, refusing.fetcher);
    await expect(failed).rejects.toMatchObject({ status: 422 });
    expect(asked(refusing)).toEqual([READ_ONLY]);
  });
});

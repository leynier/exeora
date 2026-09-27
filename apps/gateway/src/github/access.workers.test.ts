import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { accessCacheKey, repositoryAccess } from "./access.js";
import { GitHubError, GitHubReconnectError } from "./app.js";
import { authorize, envOn, fakeGitHub } from "./fixtures.js";

/**
 * What counts as GitHub saying a person has no access. The answer is
 * remembered and takes a project's link away, so only a definite one may be
 * taken for it: everything else is GitHub not answering.
 */

const USER = "usr_github_access";
const REPO = 7701;

beforeEach(async () => {
  await db(env).delete(schema.users).where(eq(schema.users.id, USER)).run();
  await db(env).insert(schema.users).values({ id: USER, email: "github-access@example.com" }).run();
  await env.OAUTH_KV.delete(accessCacheKey(USER, REPO));
  await authorize(USER);
});

const answering = (response: () => Response) => fakeGitHub(() => response());
const kept = () => env.OAUTH_KV.get(accessCacheKey(USER, REPO), "json");
const ask = async (fetcher: typeof fetch) => repositoryAccess(await envOn(), USER, REPO, fetcher);

describe("what GitHub says of a person and a repository", () => {
  it("is what they may do, and is remembered", async () => {
    const { fetcher, asked } = answering(() =>
      Response.json({ id: REPO, permissions: { admin: false, push: false, pull: true } }),
    );
    expect(await ask(fetcher)).toEqual({ pull: true, push: false });
    expect(await kept()).toEqual({ pull: true, push: false });
    expect(await ask(fetcher)).toEqual({ pull: true, push: false });
    expect(asked).toHaveLength(1);
  });

  it("is no access for a repository GitHub says is not there, or says is not theirs", async () => {
    expect(
      await ask(answering(() => Response.json({ message: "Not Found" }, { status: 404 })).fetcher),
    ).toEqual({
      pull: false,
      push: false,
    });
    expect(await kept()).toEqual({ pull: false, push: false });

    await env.OAUTH_KV.delete(accessCacheKey(USER, REPO));
    const refused = answering(() =>
      Response.json(
        { message: "You must have read access to this repository.", status: "403" },
        { status: 403 },
      ),
    );
    expect(await ask(refused.fetcher)).toEqual({ pull: false, push: false });
    expect(await kept()).toEqual({ pull: false, push: false });
  });

  it("does not take the app lacking a permission for the person lacking access", async () => {
    // GitHub's words for a token that may not do something. The person can
    // still read the repository, and a link taken away here would stay gone.
    const lacking = answering(() =>
      Response.json({ message: "Resource not accessible by integration" }, { status: 403 }),
    );

    const error = await ask(lacking.fetcher).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(GitHubError);
    expect(await kept()).toBeNull();
  });

  it("is no answer at all when GitHub is limiting requests, with or without a header to say so", async () => {
    const limits = [
      // The second kind of limit, which comes with nothing to tell it by
      // but its words.
      () =>
        Response.json(
          {
            message:
              "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
            documentation_url: "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api",
          },
          { status: 403 },
        ),
      () =>
        Response.json(
          { message: "You have triggered an abuse detection mechanism." },
          { status: 403 },
        ),
      () =>
        Response.json(
          { message: "API rate limit exceeded for user ID 1." },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } },
        ),
      // Said in the words of a refusal, and with a header that says to wait.
      () =>
        Response.json(
          { message: "Resource not accessible by integration" },
          { status: 403, headers: { "retry-after": "60" } },
        ),
      () => Response.json({ message: "slow down" }, { status: 429 }),
    ];
    for (const limit of limits) {
      const error = await ask(answering(limit).fetcher).catch((thrown) => thrown);
      expect(error).toBeInstanceOf(GitHubError);
      expect(error).not.toBeInstanceOf(GitHubReconnectError);
      expect(await kept()).toBeNull();
    }
  });

  it("is no answer when GitHub refuses without saying why, fails, or answers something else", async () => {
    const unclear = [
      () => new Response("", { status: 403 }),
      () => Response.json({ message: "Forbidden" }, { status: 403 }),
      // Not a verdict on the person: their token has yet to be let into
      // the organisation, which they can mend and the link should survive.
      () =>
        Response.json(
          { message: "Resource protected by organization SAML enforcement." },
          { status: 403 },
        ),
      () => Response.json({ message: "Server Error" }, { status: 500 }),
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      () => Response.json({ id: REPO, full_name: "acme/api" }),
      () => new Response("not json"),
    ];
    for (const answer of unclear) {
      await expect(ask(answering(answer).fetcher)).rejects.toBeInstanceOf(GitHubError);
      expect(await kept()).toBeNull();
    }
  });

  it("is asked again once GitHub answers, with nothing left over from when it did not", async () => {
    let limited = true;
    const { fetcher } = answering(() =>
      limited
        ? Response.json({ message: "You have exceeded a secondary rate limit." }, { status: 403 })
        : Response.json({ id: REPO, permissions: { push: true, pull: true } }),
    );
    await expect(ask(fetcher)).rejects.toBeInstanceOf(GitHubError);
    limited = false;
    expect(await ask(fetcher)).toEqual({ pull: true, push: true });
  });
});

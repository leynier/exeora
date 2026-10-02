import { beforeEach, describe, expect, it } from "vitest";
import {
  appJwt,
  decodeBase64,
  forgetInstallationTokens,
  type GitHubConfig,
  GitHubError,
  githubConfig,
  githubFetch,
  installationToken,
  pkcs8FromPkcs1,
} from "./app.js";
import { APP_ID, fakeGitHub, githubOn, minted, testKey } from "./fixtures.js";

/**
 * The app's own credential and the tokens it is traded for. A workers test
 * because the key is read by the runtime's WebCrypto, and that reading is
 * what has to work in production.
 */

async function config(): Promise<GitHubConfig> {
  const found = githubConfig(await githubOn());
  if (!found) throw new Error("The fixture did not configure the app.");
  return found;
}

function parts(jwt: string) {
  const [header = "", claims = "", signature = ""] = jwt.split(".");
  const read = (part: string) => JSON.parse(new TextDecoder().decode(decodeBase64(part)));
  return { header: read(header), claims: read(claims), signed: `${header}.${claims}`, signature };
}

async function verifies(jwt: string): Promise<boolean> {
  const { signed, signature } = parts(jwt);
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    (await testKey()).publicKey,
    decodeBase64(signature),
    new TextEncoder().encode(signed),
  );
}

beforeEach(() => forgetInstallationTokens());

describe("the app's JWT", () => {
  it("is RS256, dated a minute back, good for nine, and signed by the app's key", async () => {
    const now = Date.UTC(2026, 8, 26, 12, 0, 0);
    const jwt = await appJwt(await config(), now);

    expect(jwt.split(".")).toHaveLength(3);
    expect(jwt).not.toMatch(/[+/=]/);
    const { header, claims } = parts(jwt);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: APP_ID });
    expect(await verifies(jwt)).toBe(true);
  });

  it("reads the key the way GitHub downloads it", async () => {
    const key = await testKey();
    // The envelope put back around the PKCS#1 key is the one WebCrypto made.
    expect(pkcs8FromPkcs1(key.pkcs1)).toEqual(key.pkcs8);

    const jwt = await appJwt({ appId: APP_ID, privateKey: key.pkcs1Pem });
    expect(await verifies(jwt)).toBe(true);
  });

  it("reads a key pasted on one line", async () => {
    const oneLine = (await testKey()).pkcs1Pem.trim().replaceAll("\n", "\\n");
    expect(oneLine).not.toContain("\n");
    expect(await verifies(await appJwt({ appId: APP_ID, privateKey: oneLine }))).toBe(true);
  });

  it("refuses a key it cannot read, without repeating it", async () => {
    const broken = "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----";
    const error = await appJwt({ appId: APP_ID, privateKey: broken }).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toContain("GITHUB_APP_PRIVATE_KEY");
    expect((error as GitHubError).message).not.toContain("bm90IGEga2V5");
    await expect(appJwt({ appId: APP_ID, privateKey: "not a pem" })).rejects.toBeInstanceOf(
      GitHubError,
    );
  });
});

describe("the configuration", () => {
  it("is every secret or nothing, the key that keeps people's tokens among them", async () => {
    const on = await githubOn();
    expect(githubConfig(on)).toMatchObject({ appId: APP_ID, slug: "exeora-test" });
    for (const name of [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_WEBHOOK_SECRET",
      "CLOUD_CREDENTIALS_KEY",
    ] as const) {
      expect(githubConfig({ ...on, [name]: undefined })).toBeNull();
      expect(githubConfig({ ...on, [name]: "  " })).toBeNull();
    }
  });
});

describe("an installation token", () => {
  it("is asked for as the app, for the repositories and permissions named", async () => {
    const { fetcher, asked } = fakeGitHub(() => minted("ghs_one"));
    const token = await installationToken(
      await config(),
      9001,
      { repositoryIds: [7], permissions: { contents: "write", metadata: "read" } },
      fetcher,
    );

    expect(token.token).toBe("ghs_one");
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(asked).toHaveLength(1);
    const [request] = asked;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.github.com/app/installations/9001/access_tokens");
    expect(request?.body).toEqual({
      repository_ids: [7],
      permissions: { contents: "write", metadata: "read" },
    });
    expect(request?.headers.get("User-Agent")).toBe("exeora-gateway");
    expect(request?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(request?.headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    const bearer = request?.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    expect(await verifies(bearer)).toBe(true);
  });

  it("leaves out what was not narrowed", async () => {
    const { fetcher, asked } = fakeGitHub(() => minted());
    await installationToken(await config(), 9002, { permissions: { metadata: "read" } }, fetcher);
    expect(asked[0]?.body).toEqual({ permissions: { metadata: "read" } });
  });

  it("is kept until five minutes before it expires, for the same request only", async () => {
    let count = 0;
    const { fetcher } = fakeGitHub(() => {
      count += 1;
      return minted(`ghs_${count}`);
    });
    const app = await config();
    const scope = { repositoryIds: [7], permissions: { metadata: "read" } as const };
    const now = Date.now();

    expect((await installationToken(app, 9003, scope, fetcher, now)).token).toBe("ghs_1");
    expect((await installationToken(app, 9003, scope, fetcher, now + 54 * 60_000)).token).toBe(
      "ghs_1",
    );
    // Another repository, more permissions and another installation are
    // each another token: none may be answered with the one above.
    expect(
      (await installationToken(app, 9003, { ...scope, repositoryIds: [8] }, fetcher, now)).token,
    ).toBe("ghs_2");
    expect(
      (
        await installationToken(
          app,
          9003,
          { repositoryIds: [7], permissions: { metadata: "read", contents: "write" } },
          fetcher,
          now,
        )
      ).token,
    ).toBe("ghs_3");
    expect((await installationToken(app, 9004, scope, fetcher, now)).token).toBe("ghs_4");
    // Inside the last five minutes it is no longer handed out.
    expect((await installationToken(app, 9003, scope, fetcher, now + 56 * 60_000)).token).toBe(
      "ghs_5",
    );
  });

  it("says what went wrong in its own words, never in GitHub's", async () => {
    const { fetcher } = fakeGitHub(() =>
      Response.json({ message: "secret-looking detail from the response" }, { status: 422 }),
    );
    const error = await installationToken(await config(), 9005, {}, fetcher).catch(
      (thrown) => thrown,
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(422);
    expect((error as GitHubError).message).not.toContain("secret-looking");

    const offline = fakeGitHub(() => {
      throw new TypeError("network");
    });
    const unreachable = await installationToken(await config(), 9006, {}, offline.fetcher).catch(
      (thrown) => thrown,
    );
    expect(unreachable).toMatchObject({ status: 0 });
    expect((unreachable as GitHubError).message).toContain("could not be reached");
  });
});

describe("requests to GitHub", () => {
  it("does not replay a bearer at a redirect target", async () => {
    let request: Request | undefined;
    const response = await githubFetch(
      async (input, init) => {
        request = new Request(input, init);
        return new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example/collect" },
        });
      },
      "https://api.github.com/user",
      { headers: { Authorization: "Bearer user-token" } },
    );

    expect(response.status).toBe(302);
    expect(request?.redirect).toBe("manual");
    expect(request?.headers.get("Authorization")).toBe("Bearer user-token");
  });
});

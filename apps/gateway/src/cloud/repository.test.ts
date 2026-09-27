import { describe, expect, it, vi } from "vitest";
import { defaultBranchOf, pktLines, probeRepository } from "./repository.js";

/**
 * The probe against advertisements written by hand, framed the way a server
 * frames them: each line behind its own length in four hexadecimal digits.
 */

const SHA_MAIN = "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d";
const SHA_OTHER = "c3ab8ff13720e8ad9047dd39466b3c8974e592c2";
const CAPABILITIES =
  "multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not " +
  "deepen-relative no-progress include-tag multi_ack_detailed allow-tip-sha1-in-want " +
  "allow-reachable-sha1-in-want no-done symref=HEAD:refs/heads/trunk filter " +
  "object-format=sha1 agent=git/github-8e4d2f1c0a7b";

const pkt = (line: string) => `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
const FLUSH = "0000";

const advertisement = (refs: string[]) =>
  [pkt("# service=git-upload-pack\n"), FLUSH, ...refs.map(pkt), FLUSH].join("");

const GITHUB_LIKE = advertisement([
  `${SHA_MAIN} HEAD\0${CAPABILITIES}\n`,
  `${SHA_OTHER} refs/heads/feature/login\n`,
  `${SHA_MAIN} refs/heads/trunk\n`,
  `${SHA_OTHER} refs/tags/v1.0.0\n`,
]);

function answering(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => handler(new Request(input, init)));
}

const smart = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/x-git-upload-pack-advertisement" },
  });

describe("probeRepository", () => {
  it("reads the default branch out of the first reference's capabilities", async () => {
    const fetcher = answering((request) => {
      expect(request.url).toBe("https://github.com/acme/api.git/info/refs?service=git-upload-pack");
      // The second version of the protocol would answer without references.
      expect(request.headers.get("Git-Protocol")).toBeNull();
      expect(request.headers.get("Authorization")).toBeNull();
      return smart(GITHUB_LIKE);
    });

    expect(await probeRepository("https://github.com/acme/api.git", undefined, fetcher)).toEqual({
      ok: true,
      defaultBranch: "trunk",
    });
    // Written without `.git`, or with a slash after it, it is the same address.
    await probeRepository("https://github.com/acme/api", undefined, fetcher);
    await probeRepository("https://github.com/acme/api.git/", undefined, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sends the credential as git would", async () => {
    const fetcher = answering((request) => {
      expect(request.headers.get("Authorization")).toBe(
        `Basic ${btoa("x-access-token:ghp_secret")}`,
      );
      return smart(GITHUB_LIKE);
    });
    const probe = await probeRepository(
      "https://github.com/acme/private.git",
      { username: "x-access-token", password: "ghp_secret" },
      fetcher,
    );
    expect(probe).toEqual({ ok: true, defaultBranch: "trunk" });
  });

  it("says a refused token and a missing repository apart, in the words a machine would use", async () => {
    const refused = await probeRepository(
      "https://github.com/acme/private.git",
      undefined,
      answering(() => new Response("", { status: 401 })),
    );
    expect(refused).toEqual({
      ok: false,
      code: "clone_auth_failed",
      message: "The repository refused access. Set a token that can read it, then retry.",
    });
    const forbidden = await probeRepository(
      "https://github.com/acme/private.git",
      { username: "x-access-token", password: "ghp_wrong" },
      answering(() => new Response("", { status: 403 })),
    );
    expect(forbidden).toMatchObject({ ok: false, code: "clone_auth_failed" });
    expect(JSON.stringify(forbidden)).not.toContain("ghp_wrong");

    const missing = await probeRepository(
      "https://github.com/acme/nothing.git",
      undefined,
      answering(() => new Response("Not Found", { status: 404 })),
    );
    expect(missing).toEqual({
      ok: false,
      code: "repo_not_found",
      message:
        "No repository was found at that address. If it is private, set a token that can read it, then retry.",
    });
  });

  it("calls a host that does not answer, or answers badly, unreachable", async () => {
    const down = await probeRepository(
      "https://git.example.test/acme/api.git",
      undefined,
      answering(() => {
        throw new TypeError("connection refused");
      }),
    );
    expect(down).toMatchObject({ ok: false, code: "unreachable" });
    const broken = await probeRepository(
      "https://git.example.test/acme/api.git",
      undefined,
      answering(() => new Response("", { status: 502 })),
    );
    expect(broken).toMatchObject({ ok: false, code: "unreachable" });

    const never = answering(() => smart(GITHUB_LIKE));
    expect(await probeRepository("http://git.example.test/a.git", undefined, never)).toMatchObject({
      code: "unreachable",
    });
    expect(await probeRepository("not an address", undefined, never)).toMatchObject({
      code: "unreachable",
    });
    expect(never).not.toHaveBeenCalled();
  });

  it("does not take a web page for a repository", async () => {
    const page = await probeRepository(
      "https://example.test/about",
      undefined,
      answering(
        () => new Response("<html>hello</html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    expect(page).toMatchObject({ ok: false, code: "repo_not_found" });
  });

  it("follows a repository that moved, without handing its token to another host", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const fetcher = answering((request) => {
      seen.push({ url: request.url, authorization: request.headers.get("Authorization") });
      if (request.url.includes("/acme/old-name")) {
        return new Response(null, {
          status: 301,
          headers: { location: "/acme/new-name.git/info/refs?service=git-upload-pack" },
        });
      }
      if (request.url.includes("/acme/new-name")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://mirror.example.test/new.git/info/refs" },
        });
      }
      return smart(GITHUB_LIKE);
    });
    const probe = await probeRepository(
      "https://github.com/acme/old-name.git",
      { username: "u", password: "p" },
      fetcher,
    );
    expect(probe).toEqual({ ok: true, defaultBranch: "trunk" });
    expect(seen.map((request) => request.authorization !== null)).toEqual([true, true, false]);

    const loop = answering(
      (request) => new Response(null, { status: 302, headers: { location: request.url } }),
    );
    expect(await probeRepository("https://github.com/a/b.git", undefined, loop)).toMatchObject({
      code: "unreachable",
    });
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it("stops reading once it has what it came for", async () => {
    let pulled = 0;
    const first = new TextEncoder().encode(
      [pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${SHA_MAIN} HEAD\0${CAPABILITIES}\n`)].join(
        "",
      ),
    );
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled === 1) controller.enqueue(first);
        // A repository with no end of references.
        else
          controller.enqueue(new TextEncoder().encode(pkt(`${SHA_OTHER} refs/tags/t${pulled}\n`)));
      },
    });
    const probe = await probeRepository(
      "https://github.com/acme/huge.git",
      undefined,
      answering(
        () =>
          new Response(body, {
            headers: { "content-type": "application/x-git-upload-pack-advertisement" },
          }),
      ),
    );
    expect(probe).toEqual({ ok: true, defaultBranch: "trunk" });
    expect(pulled).toBeLessThan(5);
  });

  it("reads a line that arrives in pieces", async () => {
    const bytes = new TextEncoder().encode(GITHUB_LIKE);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 37) controller.enqueue(bytes.slice(at, at + 37));
        controller.close();
      },
    });
    const probe = await probeRepository(
      "https://github.com/acme/api.git",
      undefined,
      answering(
        () =>
          new Response(body, {
            headers: { "content-type": "application/x-git-upload-pack-advertisement" },
          }),
      ),
    );
    expect(probe).toEqual({ ok: true, defaultBranch: "trunk" });
  });

  it("asks for the branch by name where the repository cannot say", async () => {
    // A repository nothing was pushed to advertises its capabilities alone.
    // The branch it names there is the one the first push will make, and
    // does not exist for a machine to check out.
    const empty = await probeRepository(
      "https://github.com/acme/empty.git",
      undefined,
      answering(() =>
        smart(advertisement([`${"0".repeat(40)} capabilities^{}\0${CAPABILITIES}\n`])),
      ),
    );
    expect(empty).toMatchObject({ ok: false, code: "branch_not_found" });
    expect((empty as { message: string }).message).toContain("no branches yet");

    // HEAD on a commit that is no branch's tip.
    const detached = await probeRepository(
      "https://github.com/acme/detached.git",
      undefined,
      answering(() =>
        smart(
          advertisement([
            `${SHA_MAIN} HEAD\0multi_ack agent=git/1.8\n`,
            `${SHA_OTHER} refs/heads/main\n`,
          ]),
        ),
      ),
    );
    expect(detached).toMatchObject({ ok: false, code: "branch_not_found" });
    expect((detached as { message: string }).message).toContain("Name the branch");
  });
});

describe("the advertisement", () => {
  const lines = (text: string) => pktLines(new TextEncoder().encode(text));

  it("is split by the length in front of each line", () => {
    expect(lines(GITHUB_LIKE)).toEqual([
      "# service=git-upload-pack",
      `${SHA_MAIN} HEAD\0${CAPABILITIES}`,
      `${SHA_OTHER} refs/heads/feature/login`,
      `${SHA_MAIN} refs/heads/trunk`,
      `${SHA_OTHER} refs/tags/v1.0.0`,
    ]);
    // A line cut short is not a line yet, and garbage is not a length.
    expect(lines(GITHUB_LIKE.slice(0, 60))).toEqual(["# service=git-upload-pack"]);
    expect(lines("zzzzhello")).toEqual([]);
  });

  it("falls back to the branch HEAD is on for a server too old to say", () => {
    const old = lines(
      advertisement([
        `${SHA_MAIN} HEAD\0multi_ack thin-pack agent=git/1.8.0\n`,
        `${SHA_MAIN} refs/heads/develop\n`,
        `${SHA_MAIN} refs/heads/master\n`,
        `${SHA_OTHER} refs/heads/main\n`,
      ]),
    );
    expect(defaultBranchOf(old)).toBe("master");
    expect(defaultBranchOf(lines(GITHUB_LIKE))).toBe("trunk");
    expect(defaultBranchOf([])).toBeUndefined();
  });
});

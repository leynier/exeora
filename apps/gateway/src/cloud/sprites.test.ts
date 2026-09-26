import { describe, expect, it, vi } from "vitest";
import {
  createSprite,
  deleteSprite,
  execSprite,
  getSprite,
  listSprites,
  putService,
  SpritesError,
} from "./sprites.js";

const config = { token: "org/1/secret" };

function fetcherAnswering(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => handler(new Request(input, init)));
}

describe("the Sprites client", () => {
  it("creates a machine with a private URL and reads an existing one on 409", async () => {
    const fetcher = fetcherAnswering(async (request) => {
      if (request.method === "POST") {
        expect(await request.json()).toEqual({
          name: "exeora-abc",
          url_settings: { auth: "sprite" },
        });
        expect(request.headers.get("authorization")).toBe("Bearer org/1/secret");
        return new Response("taken", { status: 409 });
      }
      expect(request.url).toBe("https://api.sprites.dev/v1/sprites/exeora-abc");
      return Response.json({ id: "s1", name: "exeora-abc", url: "https://x", status: "cold" });
    });

    await expect(createSprite(config, "exeora-abc", fetcher)).resolves.toMatchObject({
      name: "exeora-abc",
      url: "https://x",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a missing machine as absent on read and as done on delete", async () => {
    const fetcher = fetcherAnswering(() => new Response("nope", { status: 404 }));
    await expect(getSprite(config, "gone", fetcher)).resolves.toBeNull();
    await expect(deleteSprite(config, "gone", fetcher)).resolves.toBeUndefined();
  });

  it("runs a script and reads its exit status out of the output", async () => {
    const fetcher = fetcherAnswering(async (request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/sprites/exeora-abc/exec");
      expect(url.searchParams.getAll("cmd")).toEqual(["bash", "-s"]);
      expect(url.searchParams.get("stdin")).toBe("true");
      const body = await request.text();
      expect(body).toContain("echo hi");
      expect(body).toContain("__EXEORA_EXIT_");
      return new Response("hi\n\n__EXEORA_EXIT_3__\n");
    });

    await expect(
      execSprite(config, "exeora-abc", { script: "echo hi", timeoutMs: 1000 }, fetcher),
    ).resolves.toEqual({ output: "hi\n\n", exitCode: 3 });
  });

  it("reports a script that never printed its status as unfinished", async () => {
    const fetcher = fetcherAnswering(() => new Response("partial output"));
    await expect(
      execSprite(config, "exeora-abc", { script: "true", timeoutMs: 1000 }, fetcher),
    ).resolves.toEqual({ output: "partial output", exitCode: null });
  });

  it("registers a service under its name", async () => {
    const fetcher = fetcherAnswering(async (request) => {
      expect(request.method).toBe("PUT");
      expect(request.url).toBe("https://api.sprites.dev/v1/sprites/exeora-abc/services/exeora");
      expect(await request.json()).toMatchObject({ cmd: "/bin/bash", http_port: 8080 });
      return Response.json({ name: "exeora" });
    });
    await expect(
      putService(
        config,
        "exeora-abc",
        "exeora",
        { cmd: "/bin/bash", args: ["run.sh"], needs: [], env: {}, http_port: 8080 },
        fetcher,
      ),
    ).resolves.toBeUndefined();
  });

  it("tells a rejected token apart from a service that is merely down", async () => {
    const rejected = await listSprites(
      config,
      fetcherAnswering(() => new Response("no", { status: 401 })),
    ).catch((error) => error);
    expect(rejected).toBeInstanceOf(SpritesError);
    expect((rejected as SpritesError).retryable).toBe(false);
    expect((rejected as SpritesError).message).toContain("token was rejected");

    const down = await listSprites(
      config,
      fetcherAnswering(() => new Response("bad gateway", { status: 502 })),
    ).catch((error) => error);
    expect((down as SpritesError).retryable).toBe(true);

    const unreachable = await listSprites(
      config,
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    ).catch((error) => error);
    expect((unreachable as SpritesError).status).toBe(0);
    expect((unreachable as SpritesError).retryable).toBe(true);
  });

  it("accepts the list in either envelope the API might use", async () => {
    const bare = fetcherAnswering(() => Response.json([{ name: "a" }]));
    await expect(listSprites(config, bare)).resolves.toEqual([{ name: "a" }]);
    const wrapped = fetcherAnswering(() => Response.json({ sprites: [{ name: "b" }] }));
    await expect(listSprites(config, wrapped)).resolves.toEqual([{ name: "b" }]);
  });

  it("follows the pages of a long list, under a prefix", async () => {
    const seen: string[] = [];
    const fetcher = fetcherAnswering((request) => {
      const url = new URL(request.url);
      seen.push(url.search);
      if (url.searchParams.get("continuation_token") === "t2") {
        return Response.json({ sprites: [{ name: "exeora-b" }], has_more: false });
      }
      return Response.json({
        sprites: [{ name: "exeora-a" }],
        has_more: true,
        next_continuation_token: "t2",
      });
    });
    await expect(listSprites(config, fetcher, { prefix: "exeora-" })).resolves.toEqual([
      { name: "exeora-a" },
      { name: "exeora-b" },
    ]);
    expect(seen).toEqual([
      "?max_results=500&prefix=exeora-",
      "?max_results=500&prefix=exeora-&continuation_token=t2",
    ]);
  });
});

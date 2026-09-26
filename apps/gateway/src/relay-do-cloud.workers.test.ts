import { runInDurableObject } from "cloudflare:test";
import { BASELINE_CAPABILITIES, CLOUD_FEATURE } from "@exeora/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRelayTool, requestRelayApproval } from "./relay-client.js";
import type { DeviceRelay } from "./relay-do.js";
import type { CloudWakeState } from "./relay-do-cloud.js";
import {
  attachFakeExecutor,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";

/**
 * The relay in front of a machine that sleeps. Outbound fetch is refused in
 * these tests, so the wake request goes to a fetcher the test hands the object.
 */

beforeEach(freshRelay);

const SPRITE_URL = "https://exeora-test-org.sprites.app";
const CLOUD_CLI = {
  prompt: false,
  tools: [...BASELINE_CAPABILITIES.tools],
  features: [CLOUD_FEATURE],
};

type Inside = { fetcher: typeof fetch; cloud: CloudWakeState };

async function useFetcher(fetcher: typeof fetch) {
  await runInDurableObject(relay(), (instance: DeviceRelay) => {
    (instance as unknown as Inside).fetcher = fetcher;
  });
}

async function configureCloud(wakeTimeoutMs?: number) {
  await relay().configureCloud({ url: SPRITE_URL, spriteName: "exeora-test" });
  if (wakeTimeoutMs !== undefined) {
    await runInDurableObject(relay(), (instance: DeviceRelay) => {
      (instance as unknown as Inside).cloud.wakeTimeoutMs = wakeTimeoutMs;
    });
  }
}

function call(requestId: string) {
  return callRelayTool(relay(), {
    requestId,
    projectId: "prj_test",
    tool: "read_file",
    args: { path: "readme.md" },
  });
}

describe("waking a cloud machine", () => {
  it("wakes for a capabilities question only when asked to", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await configureCloud();
    await useFetcher(fetcher);
    const executor = await attachFakeExecutor({ capabilities: CLOUD_CLI });
    await executor.ack;

    expect(await relay().capabilities()).toEqual(CLOUD_CLI);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await relay().capabilities({ wake: true })).toEqual(CLOUD_CLI);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never fetches for a device that runs itself", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await useFetcher(fetcher);
    await attachFakeExecutor();

    await expect(call("req_local")).resolves.toEqual({ echoed: { path: "readme.md" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails the caller at once when the machine does not wake, not at the relay timeout", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("starting", { status: 503 }));
    await configureCloud(1_500);
    await useFetcher(fetcher);

    const started = Date.now();
    const error = await failureOf(() => call("req_asleep"));

    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
    expect((error as { message?: string }).message).toContain("did not wake up");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(fetcher).toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SPRITE_URL}/wake`);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-org/1/not-a-real-secret",
    );
  });

  it("wakes the machine for an approval too, and reports a machine that stays down", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("starting", { status: 503 }));
    await configureCloud(1_500);
    await useFetcher(fetcher);

    const error = await failureOf(() =>
      requestRelayApproval(relay(), {
        id: "apr_asleep",
        projectId: "prj_test",
        tool: "run_command",
        prompt: "Run `npm test`?",
      }),
    );

    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
    expect((error as { message?: string }).message).toContain("did not wake up");
    expect(fetcher).toHaveBeenCalled();
  });

  it("wakes once and dispatches the calls that follow without another fetch", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await configureCloud();
    await useFetcher(fetcher);
    const executor = await attachFakeExecutor({ capabilities: CLOUD_CLI });
    await executor.ack;

    await expect(call("req_first")).resolves.toEqual({ echoed: { path: "readme.md" } });
    await expect(call("req_second")).resolves.toEqual({ echoed: { path: "readme.md" } });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(executor.seen.map((seen) => seen.requestId)).toEqual(["req_first", "req_second"]);
  });

  it("keeps a caller waiting on the wake when the old socket drops meanwhile", async () => {
    await configureCloud();
    const stale = await attachFakeExecutor({ capabilities: CLOUD_CLI, silent: true });
    await stale.ack;
    // The wake reaches a paused machine whose CLI reconnects on it: the old
    // socket closes, a new one says hello, and only then does a poll get 200.
    let awake = false;
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(awake ? "{}" : "starting", { status: awake ? 200 : 503 }),
    );
    await useFetcher(fetcher);

    const pending = call("req_woken");
    await eventually(() => expect(fetcher).toHaveBeenCalled());
    stale.socket.close(1000, "paused");
    const fresh = await attachFakeExecutor({ capabilities: CLOUD_CLI });
    await fresh.ack;
    awake = true;

    await expect(pending).resolves.toEqual({ echoed: { path: "readme.md" } });
    expect(fresh.seen.map((seen) => seen.requestId)).toEqual(["req_woken"]);
    expect(stale.seen).toEqual([]);
  });

  it("forgets the machine when the device is revoked", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await configureCloud();
    await relay().revoke();
    await useFetcher(fetcher);
    await attachFakeExecutor();

    await expect(call("req_after_revoke")).resolves.toEqual({ echoed: { path: "readme.md" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("a machine that reconnects", () => {
  it("settles a call sent to the socket that was replaced", async () => {
    const stale = await attachFakeExecutor({ silent: true });
    await stale.ack;
    const pending = failureOf(() => call("req_lost"));
    await eventually(() => expect(stale.seen).toHaveLength(1));

    const fresh = await attachFakeExecutor();
    await fresh.ack;

    const error = await pending;
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
    expect((error as { message?: string }).message).toContain("reconnected");
    fresh.socket.close(1000, "done");
  });
});

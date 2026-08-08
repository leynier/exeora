import { describe, expect, it } from "vitest";
import { hashArguments } from "./approval.js";
import { isApproved, type ToolDispatcher } from "./mcp.js";
import { PROJECT, payload, post, postModern } from "./mcp-fixtures.js";

/**
 * Asking before a tool runs.
 *
 * The mechanism arrived with MCP 2026-07-28, so the two eras get different
 * answers and both have to be right: a modern client is asked, and a 2025-era
 * one is refused rather than quietly run unconfirmed, which would make the
 * setting decorative for exactly the clients most people use today.
 */
describe("approval", () => {
  const needsApproval: ToolDispatcher = async () => ({
    kind: "needs-approval",
    projectId: PROJECT,
  });

  const writeCall = {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "write_file", arguments: { path: "src/main.ts", content: "hi" } },
  };

  it("asks a client that can be asked", async () => {
    const body = await payload(await postModern(writeCall, { rawDispatch: needsApproval }));

    const result = body.result as {
      resultType?: string;
      inputRequests?: Record<string, { params?: { message?: string } }>;
      requestState?: string;
    };

    expect(result.resultType).toBe("input_required");
    // Named, not just "approve this write": a prompt with nothing in it is one
    // people learn to click through.
    expect(result.inputRequests?.approve?.params?.message).toContain("src/main.ts");
    // The half that joins the two rounds, and the half a client cannot forge.
    expect(typeof result.requestState).toBe("string");
  });

  it("tells the dispatcher when a client cannot be asked over MCP", async () => {
    const seen: boolean[] = [];

    await payload(
      await post(writeCall, {
        rawDispatch: async (context) => {
          seen.push(context.canElicit);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    // A 2025-era client, which is claude.ai and ChatGPT today. The dispatcher
    // asks the machine's terminal or the dashboard instead; this layer only has
    // to say which kind of client it is talking to.
    expect(seen).toEqual([false]);
  });

  it("never answers a 2025-era client with an input_required it cannot read", async () => {
    // The dispatcher is not supposed to ask for a confirmation from a client
    // that cannot give one, so this stub is a bug being simulated. It must
    // surface as an error rather than as a response that looks like a hang.
    const body = await payload(await post(writeCall, { rawDispatch: needsApproval }));

    expect(JSON.stringify(body)).not.toContain("input_required");
  });

  it("tells the dispatcher nothing was confirmed when no answer came back", async () => {
    const seen: boolean[] = [];

    await payload(
      await postModern(writeCall, {
        rawDispatch: async (context) => {
          seen.push(context.approved);
          return { kind: "value", value: { ok: true } };
        },
      }),
    );

    expect(seen).toEqual([false]);
  });
});

/**
 * The gate that decides whether a confirmation still applies to this call.
 *
 * Exercised directly rather than over the wire, because the wire only reaches
 * it one way and every condition here has to be wrong in the safe direction.
 * The signature is checked before this runs, by the seam; what is left is
 * whether the approval is for the call in hand.
 */
describe("whether a round counts as approved", () => {
  const TOOL = "run_command" as const;
  const ARGS = { command: "ls" };

  /** A round carrying whatever a test wants to put in it. */
  const round = (state: unknown, answer: unknown) =>
    ({
      mcpReq: {
        requestState: () => state,
        inputResponses: answer === undefined ? undefined : { approve: answer },
      },
    }) as never;

  const accepted = (content: unknown) => ({ action: "accept", content });

  it("accepts a signed state that matches the call and a yes", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      true,
    );
  });

  /**
   * The one that matters most. Without comparing the arguments, a client could
   * have `ls` confirmed and retry with `rm -rf ~` carrying the same state: the
   * signature would verify and the tool would match.
   */
  it("refuses a retry that swapped the arguments after approval", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(
      await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, {
        command: "rm -rf ~",
      }),
    ).toBe(false);
  });

  it("refuses a state minted for another tool", async () => {
    const state = { projectId: PROJECT, tool: "write_file", argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
  });

  it("refuses a state minted for another project", async () => {
    const state = { projectId: "prj_elsewhere", tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: true })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
  });

  it("refuses a no, a decline and a cancel alike", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, accepted({ approve: false })), PROJECT, TOOL, ARGS)).toBe(
      false,
    );
    expect(await isApproved(round(state, { action: "decline" }), PROJECT, TOOL, ARGS)).toBe(false);
    expect(await isApproved(round(state, { action: "cancel" }), PROJECT, TOOL, ARGS)).toBe(false);
  });

  it("refuses anything but a boolean true", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    // A client answering with a truthy string is not a client that asked a
    // person, and must not be read as one.
    for (const answer of ["true", 1, {}, null]) {
      expect(
        await isApproved(round(state, accepted({ approve: answer })), PROJECT, TOOL, ARGS),
      ).toBe(false);
    }
  });

  it("refuses a round carrying no state at all", async () => {
    expect(
      await isApproved(round(undefined, accepted({ approve: true })), PROJECT, TOOL, ARGS),
    ).toBe(false);
  });

  it("refuses a round carrying state but no answer", async () => {
    const state = { projectId: PROJECT, tool: TOOL, argsHash: await hashArguments(ARGS) };

    expect(await isApproved(round(state, undefined), PROJECT, TOOL, ARGS)).toBe(false);
  });
});

import { MAX_APPROVAL_PROMPT_LENGTH } from "@exeora/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestRelayApproval } from "./relay-client.js";
import {
  attachFakeExecutor,
  CAN_PROMPT,
  failureOf,
  freshRelay,
  question,
  relay,
} from "./relay-do-fixtures.js";

/**
 * Asking someone before a call runs, from the relay's side: who gets the
 * question, who may answer it, and what happens when nobody does.
 */

beforeEach(freshRelay);

describe("approval", () => {
  it("refuses a prompt that cannot be shown in full", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const error = await failureOf(() =>
      requestRelayApproval(relay(), {
        ...question,
        prompt: "x".repeat(MAX_APPROVAL_PROMPT_LENGTH + 1),
      }),
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(executor.asked).toEqual([]);
    executor.socket.close(1000, "done");
  });

  it("asks the terminal and returns what it said", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: true,
    });

    expect(await requestRelayApproval(relay(), question)).toBe("approved");
    expect(executor.asked[0]?.prompt).toBe("Run `npm test`?");
    executor.socket.close(1000, "done");
  });

  it("carries a no back as a decision, not as a failure", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: false,
    });

    expect(await requestRelayApproval(relay(), question)).toBe("declined");
    executor.socket.close(1000, "done");
  });

  it("does not ask a machine with nobody at it", async () => {
    // No `capabilities.prompt`: under systemd, or in a detached pane. Sending
    // the question anyway would spend the whole ninety seconds waiting on a
    // terminal nobody is looking at, when the dashboard could answer at once.
    const executor = await attachFakeExecutor({ answerApproval: true });

    const pending = requestRelayApproval(relay(), question);
    await vi.waitFor(async () => expect(await relay().listApprovals()).toHaveLength(1));

    expect(executor.asked).toEqual([]);

    // Still answerable, which is the point: this is the headless case.
    expect(await relay().answerApproval(question.id, true)).toBe(true);
    expect(await pending).toBe("approved");
    executor.socket.close(1000, "done");
  });

  it("lets the dashboard answer, and tells the terminal the question is over", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), question);
    await vi.waitFor(() => expect(executor.asked).toHaveLength(1));

    await relay().answerApproval(question.id, true);

    expect(await pending).toBe("approved");
    // Without this the prompt would sit on the terminal, and typing into it
    // would do nothing, which is worse than never having shown it.
    await vi.waitFor(() => expect(executor.resolved).toEqual([question.id]));
    executor.socket.close(1000, "done");
  });

  it("gives the first answer the decision and the second nothing", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: true,
    });

    expect(await requestRelayApproval(relay(), question)).toBe("approved");
    // The terminal already settled it. A dashboard click landing now finds
    // nothing, which is what the 409 in the API is built on.
    expect(await relay().answerApproval(question.id, false)).toBe(false);
    executor.socket.close(1000, "done");
  });

  it("lists what is waiting, so the dashboard has something to show", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), { ...question, clientName: "ChatGPT" });
    await vi.waitFor(async () => expect(await relay().listApprovals()).toHaveLength(1));

    const [waiting] = await relay().listApprovals();
    expect(waiting).toMatchObject({
      id: question.id,
      projectId: "prj_test",
      tool: "run_command",
      prompt: "Run `npm test`?",
      clientName: "ChatGPT",
    });

    await relay().answerApproval(question.id, false);
    expect(await pending).toBe("declined");
    executor.socket.close(1000, "done");
  });

  it("refuses to ask when no machine is connected", async () => {
    // Nothing to confirm: the call would fail either way, and the one thing
    // this spends is a person's attention.
    const error = await failureOf(() => requestRelayApproval(relay(), question));
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });

  it("ends a question when the machine goes away", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), question);
    await vi.waitFor(() => expect(executor.asked).toHaveLength(1));

    executor.socket.close(1000, "gone");

    // Not left to time out: the call it guards cannot run now regardless, so
    // waiting the full ninety seconds would only delay saying so.
    expect(await pending).toBe("unanswered");
    expect(await relay().listApprovals()).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_GREP_MATCHES,
  MAX_PROCESSES_PER_PROJECT,
  MAX_READ_BYTES,
} from "./limits.js";
import { AGENT_PROMPT_NAME, AGENT_PROMPT_TOOL, agentPrompt, serverInstructions } from "./prompt.js";
import { TOOL_NAMES } from "./tools.js";
import { ACCOUNT_TOOL_NAMES } from "./tools-account.js";

/**
 * The prompt as five surfaces publish it.
 *
 * Both MCP endpoints, the `coding_agent` prompt, the `get_agent_prompt` tool,
 * `exeora prompt` and the documentation page all read these two functions, so
 * a claim that goes stale here goes stale everywhere at once. What is asserted
 * is the part a reader cannot check by eye: that the limits quoted are the ones
 * the executor enforces, and that the account variant differs only where the
 * account endpoint actually differs.
 */

describe("agentPrompt", () => {
  it("names every tool it expects the agent to reach for", () => {
    const prompt = agentPrompt();

    for (const name of TOOL_NAMES) {
      expect(prompt, `${name} is never mentioned`).toContain(name);
    }
  });

  it("quotes the limits the executor actually enforces", () => {
    const prompt = agentPrompt();

    // Typed out as they appear to the reader, so a change to a constant fails
    // here rather than leaving the prompt promising a budget nobody honours.
    expect(prompt).toContain(`${Math.round(MAX_READ_BYTES / 1000)}KB`);
    expect(prompt).toContain(`${MAX_GREP_MATCHES} matches`);
    expect(prompt).toContain(`${DEFAULT_COMMAND_TIMEOUT_MS / 1000}s`);
    expect(prompt).toContain(`${MAX_PROCESSES_PER_PROJECT} live processes`);
  });

  it("explains per-call project selection only on the account endpoint", () => {
    const project = agentPrompt();
    const account = agentPrompt({ account: true });

    for (const name of ACCOUNT_TOOL_NAMES) {
      if (name !== "list_worktrees") {
        expect(project, `${name} has no meaning on a per-project URL`).not.toContain(name);
      }
      expect(account, `${name} is unexplained on the account URL`).toContain(name);
    }

    expect(account).toContain("every executor tool call");
    expect(account).toContain("Other conversations can work in other projects");
    expect(account).not.toContain("active project");
    expect(project).not.toContain("every executor tool call");
  });

  it("says a refusal is a decision rather than something to work around", () => {
    // The single most important line in the prompt: an agent that routes around
    // a policy refusal defeats the reason the policy exists.
    const prompt = agentPrompt();

    expect(prompt).toContain("FORBIDDEN");
    expect(prompt).toContain("APPROVAL_DECLINED");
    expect(prompt).toContain("APPROVAL_TIMEOUT");
    expect(prompt).toContain("answers, not obstacles");
    expect(prompt).toContain("route around it");
  });
});

describe("serverInstructions", () => {
  it("stays small enough to sit in every request", () => {
    // A client that honours `instructions` keeps them for the whole session, so
    // this text is charged on every request. The ceiling is what stops it
    // growing into a second copy of the full prompt one useful line at a time.
    expect(serverInstructions().length).toBeLessThan(2_000);
    expect(serverInstructions({ account: true }).length).toBeLessThan(2_400);
  });

  it("points at the full prompt by the names that serve it", () => {
    const instructions = serverInstructions();

    expect(instructions).toContain(AGENT_PROMPT_NAME);
    expect(instructions).toContain(AGENT_PROMPT_TOOL.name);
  });

  it("carries the rules that cannot wait for the full prompt", () => {
    const instructions = serverInstructions();

    expect(instructions).toContain("PATH_ESCAPE");
    expect(instructions).toContain("edit_file");
    expect(instructions).toContain("FORBIDDEN");
  });
});

describe("AGENT_PROMPT_TOOL", () => {
  it("is not part of the executor contract", () => {
    // It is answered in the gateway. Landing in TOOL_DEFINITIONS would make
    // every CLI released so far look as though it were missing a tool.
    expect(TOOL_NAMES).not.toContain(AGENT_PROMPT_TOOL.name);
    expect(ACCOUNT_TOOL_NAMES).not.toContain(AGENT_PROMPT_TOOL.name);
  });

  it("changes nothing", () => {
    expect(AGENT_PROMPT_TOOL.readOnly).toBe(true);
  });
});

import { agentPrompt } from "@exeora/protocol";
import type { Command } from "commander";
import { asJson, emit, guard } from "../output.js";

/** The coding-agent prompt, for a client that cannot fetch it itself. */
export function register(program: Command): void {
  program
    .command("prompt")
    .description("Print the Exeora coding-agent prompt, for a client that cannot fetch it itself")
    .option("-a, --account", "The variant for the account URL, which reaches several projects")
    .action(
      guard(async (options: { account?: boolean }) => {
        // Every client that speaks MCP already gets this over the wire, as the
        // handshake instructions, the `coding_agent` prompt and the
        // `get_agent_prompt` tool. This command is for the ones that do not ask:
        // a custom GPT with a system prompt box, an agent framework being wired
        // up by hand, a project's own AGENTS.md.
        const text = agentPrompt({ account: options.account === true });

        // Straight to stdout rather than through `p.log`, because the whole point
        // is that it pipes: `exeora prompt | pbcopy`, `> AGENTS.md`. Anything
        // drawn around it would end up in the file.
        if (asJson()) return emit({ prompt: text });
        process.stdout.write(`${text}\n`);
      }),
    );
}

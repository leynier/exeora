import * as p from "@clack/prompts";
import type { Command } from "commander";
import { config, DEFAULT_GATEWAY, gatewaySource, gatewayUrl } from "../config.js";
import { changeGateway, describeSource } from "../gateway.js";
import { asJson, emit, guard } from "../output.js";

/**
 * Which Exeora this install talks to.
 *
 * The gateway is open source, so the hosted one is a default and not an
 * address. Every URL the CLI builds is rooted at whatever this holds, which is
 * why changing it is a command of its own rather than a setting buried in
 * `connect`.
 */
export function register(program: Command): void {
  /** What to do once the gateway has changed and nothing is registered on it. */
  const CONNECT_NEXT = "Run `exeora connect` to sign in and register this machine.";

  const gatewayCommand = program
    .command("gateway")
    .description("Show or change the Exeora this machine talks to")
    .action(
      guard(async () => {
        const source = gatewaySource();

        if (asJson()) return emit({ gateway: gatewayUrl(), source });

        p.log.message(`Gateway  ${gatewayUrl()}  (${describeSource(source)})`);
        if (source === "env") {
          p.log.info(`Stored:  ${config.get("gatewayUrl")}, which the variable is covering up.`);
        }
      }),
    );

  gatewayCommand
    .command("use <url>")
    .description("Talk to a different Exeora, forgetting what belongs to this one")
    .option("-y, --yes", "Do not ask before forgetting the current registration")
    .option("--force", "Switch without checking that a gateway answers there")
    .action(
      guard(async (url: string, options: { yes?: boolean; force?: boolean }) => {
        await changeGateway(url, { ...options, nextStep: CONNECT_NEXT });
      }),
    );

  gatewayCommand
    .command("reset")
    .description(`Go back to ${DEFAULT_GATEWAY}`)
    .option("-y, --yes", "Do not ask before forgetting the current registration")
    .option("--force", "Switch without checking that a gateway answers there")
    .action(
      guard(async (options: { yes?: boolean; force?: boolean }) => {
        await changeGateway(DEFAULT_GATEWAY, { ...options, nextStep: CONNECT_NEXT });
      }),
    );
}

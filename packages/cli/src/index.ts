#!/usr/bin/env node
import { Command } from "commander";
import * as auth from "./commands/auth.js";
import * as connect from "./commands/connect.js";
import * as device from "./commands/device.js";
import * as gateway from "./commands/gateway.js";
import * as init from "./commands/init.js";
import * as logs from "./commands/logs.js";
import * as project from "./commands/project.js";
import * as prompt from "./commands/prompt.js";
import * as status from "./commands/status.js";
import * as sync from "./commands/sync.js";
import * as upgrade from "./commands/upgrade.js";
import { asJson, configureOutput } from "./output.js";
import { interactive, maybeAskForStar } from "./star.js";
import { CLI_VERSION } from "./version.js";

/**
 * The binary. Nothing here does any work: each command registers itself, and
 * the order below is the order `--help` prints them in.
 */

const program = new Command()
  .name("exeora")
  .description(
    "Connect AI agents to the development environment on this machine, wherever it runs.",
  )
  .version(CLI_VERSION, "-v, --version")
  .option("--json", "Print machine-readable output instead of drawing on the terminal");

configureOutput(program);

/**
 * Counts the run, and on the third one asks for a star.
 *
 * A hook rather than a line in each action: it fires once per command actually
 * run, subcommands included, and it fires after the options are parsed, so
 * `asJson()` is already the truth by the time it is read. `--help` and
 * `--version` never reach an action and so never count as a run, which is
 * right — nobody used the tool.
 */
program.hook("preAction", () => maybeAskForStar(interactive(asJson())));

auth.register(program);
gateway.register(program);
device.register(program);
project.register(program);
connect.register(program);
status.register(program);
logs.register(program);
init.register(program);
prompt.register(program);
sync.register(program);
upgrade.register(program);

program.parseAsync(process.argv);

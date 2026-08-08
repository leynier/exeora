import { hostname } from "node:os";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { config } from "../config.js";
import { isOnline, pad } from "../format.js";
import { asJson, emit, guard } from "../output.js";
import { CLI_VERSION } from "../version.js";

/** The machine itself: registering it, and listing what is registered. */
export function register(program: Command): void {
  const device = program.command("device").description("Manage this machine");

  device
    .command("register")
    .description("Register this machine so it can serve tool calls")
    .option("-n, --name <name>", "Display name", hostname())
    .action(
      guard(async (options: { name: string }) => {
        const existing = config.get("deviceId");
        if (existing) {
          p.log.info(`Already registered as ${config.get("deviceName")} (${existing}).`);
          return;
        }

        const registered = await gateway.registerDevice({
          name: options.name,
          platform: process.platform,
          cliVersion: CLI_VERSION,
        });

        config.set("deviceId", registered.id);
        config.set("deviceName", registered.name);
        p.log.success(`Registered ${registered.name} (${registered.id}).`);
      }),
    );

  device
    .command("list")
    .description("List your registered machines")
    .action(
      guard(async () => {
        const devices = await gateway.listDevices();

        if (asJson()) {
          return emit(
            devices.map((entry) => ({
              ...entry,
              online: isOnline(entry),
              thisMachine: entry.id === config.get("deviceId"),
            })),
          );
        }

        if (devices.length === 0) return p.log.info("No devices registered yet.");

        for (const entry of devices) {
          const status = entry.revokedAt ? "revoked" : isOnline(entry) ? "online" : "offline";
          const thisOne = entry.id === config.get("deviceId") ? "  (this machine)" : "";
          p.log.message(`${pad(entry.name, 20)} ${pad(status, 9)} ${entry.platform}${thisOne}`);
        }
      }),
    );
}

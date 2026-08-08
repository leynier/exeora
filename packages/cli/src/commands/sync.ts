import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { config, forgetLocalState, projects } from "../config.js";
import { decideDevice } from "../onboard.js";
import { guard } from "../output.js";
import { reconcile } from "../sync.js";

/** Reconciling this machine's registration and projects with the dashboard. */
export function register(program: Command): void {
  program
    .command("sync")
    .description("Reconcile this machine's registration and projects with the dashboard")
    .action(
      guard(async () => {
        const [devices, remote] = await Promise.all([
          gateway.listDevices(),
          gateway.listProjects(),
        ]);

        const storedId = config.get("deviceId");
        if (storedId === undefined) {
          p.log.info("This machine is not registered. Run `exeora connect` first.");
          return;
        }

        const decision = decideDevice(storedId, devices);

        if (decision.kind === "register") {
          // The dashboard deleted this machine permanently, which cascades its
          // projects; the local config is the only place they still exist.
          const count = projects().length;
          forgetLocalState();
          p.log.warn(
            `This machine was deleted from the dashboard. Forgot it and its ${count} project${count === 1 ? "" : "s"}. Run \`exeora connect\` to register again.`,
          );
          return;
        }

        if (decision.kind === "revoked") {
          p.log.warn(
            `This machine (${decision.name}) was revoked from the dashboard, so it will not serve tool calls. Run \`exeora connect --reset\` to register it again.`,
          );
        }

        const result = reconcile(projects(), remote, storedId);
        config.set("projects", result.next);

        for (const entry of result.removed) {
          p.log.info(`Removed ${entry.slug} (gone from the dashboard).`);
        }
        for (const entry of result.added) {
          p.log.info(`Added ${entry.slug}.`);
        }
        for (const entry of result.updated) {
          p.log.info(`Updated ${entry.slug}.`);
        }

        const changes = result.removed.length + result.added.length + result.updated.length;
        if (changes === 0 && decision.kind === "use") p.log.success("Already up to date.");
      }),
    );
}

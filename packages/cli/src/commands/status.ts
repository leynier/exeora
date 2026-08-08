import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { NotSignedInError } from "../auth/tokens.js";
import { config, configPath, gatewaySource, gatewayUrl, projects } from "../config.js";
import { accountMcpUrl, pad } from "../format.js";
import { describeSource } from "../gateway.js";
import { asJson, emit, guard } from "../output.js";

/** Where this machine stands: gateway, registration, projects, URLs. */
export function register(program: Command): void {
  program
    .command("status")
    .description("Show this machine's registration and projects")
    .action(
      guard(async () => {
        const deviceId = config.get("deviceId");
        const json = asJson();

        if (!json) {
          p.log.message(`Gateway   ${gatewayUrl()} (${describeSource(gatewaySource())})`);
          // Printed whether or not this machine serves anything: it is the same
          // URL for every account, and someone reading `status` to find out what
          // to paste into a client should not have to go and look it up.
          p.log.message(`One URL   ${accountMcpUrl()}`);
          p.log.message(`Config    ${configPath()}`);
          p.log.message(
            `Device    ${deviceId ? `${config.get("deviceName")} (${deviceId})` : "not registered"}`,
          );
        }

        let email: string | null = null;
        try {
          email = (await gateway.me()).email;
          if (!json) p.log.message(`Signed in ${email}`);
        } catch (error) {
          const signedOut = error instanceof NotSignedInError;
          const why = signedOut ? "not signed in, run `exeora connect`" : "unknown";

          // Not signed in is a state to report, not a failure: `status` answering
          // with an error would make it useless for the one question it exists
          // for, which is whether this machine is set up at all.
          //
          // A gateway that cannot be reached is a different answer, and one a
          // script acts on differently: it says nothing about whether anyone is
          // signed in, so it must not be reported as a no.
          if (json) {
            return emit({
              gateway: gatewayUrl(),
              gatewaySource: gatewaySource(),
              config: configPath(),
              accountMcpUrl: accountMcpUrl(),
              device: deviceId ? { id: deviceId, name: config.get("deviceName") } : null,
              signedIn: signedOut ? false : null,
              ...(signedOut
                ? {}
                : { error: error instanceof Error ? error.message : String(error) }),
              projects: [],
            });
          }

          p.log.message(`Signed in ${why}`);
          return;
        }

        const remote = new Set((await gateway.listProjects()).map((project) => project.id));
        const local = projects();

        if (json) {
          return emit({
            gateway: gatewayUrl(),
            gatewaySource: gatewaySource(),
            config: configPath(),
            accountMcpUrl: accountMcpUrl(),
            device: deviceId ? { id: deviceId, name: config.get("deviceName") } : null,
            signedIn: true,
            email,
            projects: local.map((entry) => ({
              ...entry,
              mcpUrl: new URL(`/p/${entry.id}/mcp`, gatewayUrl()).toString(),
              // False means the gateway has never heard of it, usually because it
              // was removed from the dashboard. `exeora sync` reconciles.
              knownToGateway: remote.has(entry.id),
            })),
          });
        }

        p.log.message(`Projects  ${local.length === 0 ? "none" : ""}`);
        for (const entry of local) {
          const known = remote.has(entry.id) ? "" : " (unknown to the gateway)";
          p.log.message(`  ${pad(entry.slug, 18)} ${entry.root}${known}`);
        }
      }),
    );
}

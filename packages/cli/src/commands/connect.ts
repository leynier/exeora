import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gatewayUrl, projects } from "../config.js";
import { connect } from "../connection.js";
import { accountMcpUrl } from "../format.js";
import { useGateway } from "../gateway.js";
import { prepare } from "../onboard.js";
import { asJson, guard } from "../output.js";

/**
 * The one command most people run: serve a directory to their AI clients,
 * signing in and registering whatever is not registered yet.
 */
export function register(program: Command): void {
  program
    .command("connect [path]")
    .description("Serve a directory to your AI clients (signs in and registers as needed)")
    .option("-s, --slug <slug>", "Short name used in the MCP URL")
    .option("-n, --name <name>", "Display name for this machine, when registering it")
    .option("--no-add", "Serve the projects already registered, without adding this directory")
    .option("--reset", "Forget the stored machine and register a fresh one")
    .option("-g, --gateway <url>", "Serve to this Exeora instead, and remember it")
    .option("-y, --yes", "Do not ask before switching gateway")
    .action(
      guard(
        async (
          path: string | undefined,
          options: {
            add: boolean;
            reset: boolean;
            slug?: string;
            name?: string;
            gateway?: string;
            yes?: boolean;
          },
        ) => {
          if (!asJson()) p.intro("Exeora");

          // Before anything is asked of a gateway, settle which one. Signing in
          // and registering the machine both have to land on the new one.
          if (!(await useGateway(options))) return;

          // Sign in, register the machine and register the directory, skipping
          // whichever of those is already done. This is the whole reason the
          // other commands are optional.
          const ready = await prepare({
            path,
            add: options.add,
            reset: options.reset,
            slug: options.slug,
            name: options.name,
          });

          if (!asJson()) {
            if (ready.project) {
              p.note(
                new URL(`/p/${ready.project.id}/mcp`, gatewayUrl()).toString(),
                "MCP URL, add this to Claude, ChatGPT or Cursor",
              );
              p.log.info(`Or ${accountMcpUrl()} once, for every project at the same time.`);
            } else if (projects().length === 0) {
              p.log.warn("No projects registered on this machine yet.");
            }

            p.log.info(`Machine: ${ready.deviceName}`);
            p.log.info(`Gateway: ${gatewayUrl()}`);
            p.log.info("Press Ctrl+C to stop.\n");
          }

          /**
           * One JSON object per line, rather than one document.
           *
           * `connect` never finishes, so there is no document to close. A line at
           * a time is what a supervisor or a log collector can consume as it
           * arrives, which is the only reason to want JSON from a command that
           * runs all day.
           */
          const event = (payload: Record<string, unknown>) =>
            process.stdout.write(`${JSON.stringify({ at: Date.now(), ...payload })}\n`);

          const connection = connect(ready.deviceId, {
            onOpen: () =>
              asJson()
                ? event({ event: "open" })
                : p.log.success("Connected. Waiting for tool calls."),
            onClose: (reason) =>
              asJson() ? event({ event: "close", reason }) : p.log.warn(reason),
            onError: (message) =>
              asJson() ? event({ event: "error", message }) : p.log.error(message),
            onNotice: (message) =>
              asJson() ? event({ event: "notice", message }) : p.log.info(message),
            // Not offered under `--json`: there is nobody at a terminal that is
            // being piped somewhere, so the question goes to the dashboard.
            ...(asJson() ? {} : { onApproval: confirmCall }),
            onCall: (tool, slug, client) =>
              asJson()
                ? event({ event: "call", tool, project: slug, client })
                : p.log.message(`→ ${tool} (${slug})${client ? ` · ${client}` : ""}`),
            onResult: (tool, ok, durationMs) =>
              asJson()
                ? event({ event: "result", tool, ok, durationMs })
                : p.log.message(`${ok ? "✓" : "✗"} ${tool} ${durationMs}ms`),
          });

          const stop = () => connection.stop();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);

          await connection.closed;
          if (!asJson()) p.outro("Disconnected.");
        },
      ),
    );
}

/**
 * Asks whether one call may run, on this terminal.
 *
 * The project asked for confirmation and the AI client cannot be asked, which
 * today means claude.ai and ChatGPT. This is the only place left that has a
 * person in front of it.
 *
 * Cancelling is a no. So is a prompt that goes away because the dashboard
 * answered first or because the question expired: `signal` fires, `p.confirm`
 * resolves as cancelled, and the caller ignores the answer either way. There is
 * no reading of "the prompt disappeared" that means yes.
 */
async function confirmCall(ask: {
  prompt: string;
  tool: string;
  projectSlug: string;
  client?: string | undefined;
  signal: AbortSignal;
}): Promise<boolean> {
  const asked = `${ask.projectSlug}${ask.client ? ` · ${ask.client}` : ""}`;
  p.log.warn(`${ask.prompt}  (${asked})`);

  const answer = await p.confirm({
    message: "Allow it?",
    initialValue: false,
    signal: ask.signal,
  });

  if (p.isCancel(answer)) return false;
  return answer;
}

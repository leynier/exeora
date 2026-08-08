import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { ago, nameOf, pad } from "../format.js";
import { asJson, emit, guard } from "../output.js";

/** Recent tool calls: what ran, who asked, and how it ended. */
export function register(program: Command): void {
  program
    .command("logs")
    .description("Show recent tool calls: what ran, who asked and how it ended")
    .option("-n, --limit <count>", "How many calls to show", "30")
    .option("-p, --project <slug>", "Only calls against this project")
    .option("-c, --client <name>", "Only calls from clients whose name contains this")
    .option("--failed", "Only calls that ended in an error")
    .action(
      guard(
        async (options: { limit: string; project?: string; client?: string; failed?: boolean }) => {
          const limit = Number.parseInt(options.limit, 10);
          if (!Number.isInteger(limit) || limit < 1) {
            throw new Error("--limit takes a positive whole number.");
          }

          // Filtering happens here rather than on the server, which returns the
          // newest rows for the whole account: a narrow filter over a wide window
          // is the useful direction, and it is one request either way.
          const [calls, remote] = await Promise.all([
            gateway.listToolCalls(limit),
            gateway.listProjects(),
          ]);

          const byId = new Map(remote.map((project) => [project.id, project]));
          const wanted = options.project?.toLowerCase();
          const client = options.client?.toLowerCase();

          const rows = calls.filter((call) => {
            if (options.failed && call.status !== "error") return false;
            if (wanted && byId.get(call.projectId)?.slug.toLowerCase() !== wanted) return false;
            if (client && !nameOf(call).toLowerCase().includes(client)) return false;
            return true;
          });

          if (asJson()) {
            return emit(
              rows.map((call) => ({
                ...call,
                projectSlug: byId.get(call.projectId)?.slug ?? null,
              })),
            );
          }

          if (rows.length === 0) {
            p.log.info(
              calls.length === 0
                ? "No tool calls yet. They appear here as soon as an agent makes one."
                : "Nothing matches those filters.",
            );
            return;
          }

          for (const call of rows.reverse()) {
            const slug = byId.get(call.projectId)?.slug ?? "removed";
            const failure = call.errorCode ? ` ${call.errorCode}` : "";
            p.log.message(
              `${call.status === "ok" ? "✓" : "✗"} ${pad(call.tool, 12)} ${pad(slug, 16)} ${pad(nameOf(call), 20)} ${pad(`${call.durationMs}ms`, 8)} ${ago(call.createdAt)}${failure}`,
            );
          }
        },
      ),
    );
}

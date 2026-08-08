import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { config, gatewayUrl, projects, removeProject, upsertProject } from "../config.js";
import { accountMcpUrl, pad } from "../format.js";
import { slugify } from "../onboard.js";
import { asJson, emit, guard } from "../output.js";

/** The directories this machine serves, one subcommand per verb. */
export function register(program: Command): void {
  const project = program.command("project").description("Manage projects on this machine");

  project
    .command("add [path]")
    .description("Register a local directory as a project")
    .option("-s, --slug <slug>", "Short name used in URLs")
    .action(
      guard(async (path: string | undefined, options: { slug?: string }) => {
        const deviceId = config.get("deviceId");
        if (!deviceId) {
          p.log.error("This machine is not registered. Run `exeora device register` first.");
          process.exitCode = 1;
          return;
        }

        const root = resolve(path ?? ".");
        const name = basename(root);
        const slug = options.slug ?? slugify(name);

        const added = await gateway.addProject({ deviceId, name, slug, localPath: root });
        upsertProject({ id: added.id, slug: added.slug, name: added.name, root });

        const url = new URL(`/p/${added.id}/mcp`, gatewayUrl()).toString();
        p.log.success(`Added ${added.name}.`);
        p.note(url, "MCP URL, add this to Claude, ChatGPT or Cursor");
        p.log.info(`Or ${accountMcpUrl()} once, for every project at the same time.`);
        p.log.info("Run `exeora connect` here and leave it running.");
      }),
    );

  project
    .command("list")
    .description("List projects registered on this machine")
    .action(
      guard(async () => {
        const local = projects();

        if (asJson()) {
          return emit(
            local.map((entry) => ({
              ...entry,
              mcpUrl: new URL(`/p/${entry.id}/mcp`, gatewayUrl()).toString(),
            })),
          );
        }

        if (local.length === 0) return p.log.info("No projects yet. Run `exeora connect` in one.");

        for (const entry of local) {
          p.log.message(`${pad(entry.slug, 20)} ${entry.root}`);
          p.log.message(`${" ".repeat(20)} ${new URL(`/p/${entry.id}/mcp`, gatewayUrl())}`);
        }

        p.log.info(`Or ${accountMcpUrl()} once, for every project at the same time.`);
      }),
    );

  project
    .command("remove <slug>")
    .description("Stop serving a project from this machine")
    .action(
      guard(async (slug: string) => {
        const entry = projects().find((candidate) => candidate.slug === slug);
        if (!entry) {
          p.log.error(`No project called ${slug} on this machine.`);
          process.exitCode = 1;
          return;
        }
        await gateway.removeProject(entry.id);
        removeProject(entry.id);
        p.log.success(`Removed ${slug}.`);
      }),
    );
}

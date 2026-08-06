#!/usr/bin/env node
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { gateway, type ToolCallView } from "./api.js";
import { login } from "./auth/login.js";
import { clearCredentials, usingFileFallback } from "./auth/store.js";
import { cacheAccessToken, forgetAccessToken, NotSignedInError } from "./auth/tokens.js";
import {
  config,
  configPath,
  gatewayUrl,
  projects,
  removeProject,
  upsertProject,
} from "./config.js";
import { connect } from "./connection.js";
import { decideDevice, prepare, slugify } from "./onboard.js";
import { reconcile } from "./sync.js";
import { CLI_VERSION } from "./version.js";

const program = new Command()
  .name("exeora")
  .description(
    "Connect AI agents to the development environment on this machine, wherever it runs.",
  )
  .version(CLI_VERSION, "-v, --version");

// ---------------------------------------------------------------------------

program
  .command("login")
  .description("Sign in to Exeora in your browser")
  .action(
    guard(async () => {
      p.intro("Exeora");
      const spinner = p.spinner();
      spinner.start("Waiting for the browser…");

      const result = await login();
      cacheAccessToken(result.accessToken, result.expiresAt);
      const user = await gateway.me();

      spinner.stop(`Signed in as ${user.email}`);
      if (usingFileFallback()) {
        p.log.warn(
          `No system keychain available, so the session is stored in a 0600 file under ${configPath().replace(/config\.json$/, "")}.`,
        );
      }
      p.outro("Run `exeora connect` in a project directory.");
    }),
  );

program
  .command("logout")
  .description("Forget the stored session on this machine")
  .action(
    guard(async () => {
      await clearCredentials();
      forgetAccessToken();
      p.log.success("Signed out. The device is still registered; revoke it in the dashboard.");
    }),
  );

// ---------------------------------------------------------------------------

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
      if (devices.length === 0) return p.log.info("No devices registered yet.");

      for (const entry of devices) {
        const status = entry.revokedAt
          ? "revoked"
          : online(entry.lastSeenAt)
            ? "online"
            : "offline";
        const thisOne = entry.id === config.get("deviceId") ? "  (this machine)" : "";
        p.log.message(`${pad(entry.name, 20)} ${pad(status, 9)} ${entry.platform}${thisOne}`);
      }
    }),
  );

// ---------------------------------------------------------------------------

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
      p.log.info("Run `exeora connect` here and leave it running.");
    }),
  );

project
  .command("list")
  .description("List projects registered on this machine")
  .action(
    guard(async () => {
      const local = projects();
      if (local.length === 0) return p.log.info("No projects yet. Run `exeora connect` in one.");

      for (const entry of local) {
        p.log.message(`${pad(entry.slug, 20)} ${entry.root}`);
        p.log.message(`${" ".repeat(20)} ${new URL(`/p/${entry.id}/mcp`, gatewayUrl())}`);
      }
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

// ---------------------------------------------------------------------------

program
  .command("connect [path]")
  .description("Serve a directory to your AI clients (signs in and registers as needed)")
  .option("-s, --slug <slug>", "Short name used in the MCP URL")
  .option("-n, --name <name>", "Display name for this machine, when registering it")
  .option("--no-add", "Serve the projects already registered, without adding this directory")
  .option("--reset", "Forget the stored machine and register a fresh one")
  .action(
    guard(
      async (
        path: string | undefined,
        options: { add: boolean; reset: boolean; slug?: string; name?: string },
      ) => {
        p.intro("Exeora");

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

        if (ready.project) {
          p.note(
            new URL(`/p/${ready.project.id}/mcp`, gatewayUrl()).toString(),
            "MCP URL, add this to Claude, ChatGPT or Cursor",
          );
        } else if (projects().length === 0) {
          p.log.warn("No projects registered on this machine yet.");
        }

        p.log.info(`Machine: ${ready.deviceName}`);
        p.log.info(`Gateway: ${gatewayUrl()}`);
        p.log.info("Press Ctrl+C to stop.\n");

        const connection = connect(ready.deviceId, {
          onOpen: () => p.log.success("Connected. Waiting for tool calls."),
          onClose: (reason) => p.log.warn(reason),
          onError: (message) => p.log.error(message),
          onCall: (tool, slug, client) =>
            p.log.message(`→ ${tool} (${slug})${client ? ` · ${client}` : ""}`),
          onResult: (tool, ok, ms) => p.log.message(`${ok ? "✓" : "✗"} ${tool} ${ms}ms`),
        });

        const stop = () => connection.stop();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);

        await connection.closed;
        p.outro("Disconnected.");
      },
    ),
  );

program
  .command("status")
  .description("Show this machine's registration and projects")
  .action(
    guard(async () => {
      const deviceId = config.get("deviceId");
      p.log.message(`Gateway   ${gatewayUrl()}`);
      p.log.message(`Config    ${configPath()}`);
      p.log.message(
        `Device    ${deviceId ? `${config.get("deviceName")} (${deviceId})` : "not registered"}`,
      );

      try {
        const user = await gateway.me();
        p.log.message(`Signed in ${user.email}`);
      } catch (error) {
        p.log.message(
          `Signed in ${error instanceof NotSignedInError ? "not signed in, run `exeora connect`" : "unknown"}`,
        );
        return;
      }

      const remote = new Set((await gateway.listProjects()).map((project) => project.id));

      const local = projects();
      p.log.message(`Projects  ${local.length === 0 ? "none" : ""}`);
      for (const entry of local) {
        const known = remote.has(entry.id) ? "" : " (unknown to the gateway)";
        p.log.message(`  ${pad(entry.slug, 18)} ${entry.root}${known}`);
      }
    }),
  );

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

program
  .command("sync")
  .description("Reconcile this machine's registration and projects with the dashboard")
  .action(
    guard(async () => {
      const [devices, remote] = await Promise.all([gateway.listDevices(), gateway.listProjects()]);

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
        config.delete("deviceId");
        config.delete("deviceName");
        config.set("projects", []);
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

// ---------------------------------------------------------------------------

/** Turns a thrown error into one readable line instead of a stack trace. */
function guard<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
}

function online(lastSeenAt: number | null): boolean {
  return lastSeenAt !== null && Date.now() - lastSeenAt < 90_000;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * The AI client behind a call.
 *
 * The registered name is preferred over the raw client id, which is opaque and
 * says nothing to a reader. Calls recorded before a client was ever nameable
 * fall through to "unknown" rather than showing that id.
 */
function nameOf(call: ToolCallView): string {
  return call.clientName ?? (call.clientId ? "unknown" : "—");
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

program.parseAsync(process.argv);

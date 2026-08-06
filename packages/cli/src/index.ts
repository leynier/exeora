#!/usr/bin/env node
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { gateway } from "./api.js";
import { login } from "./auth/login.js";
import { clearCredentials, usingFileFallback } from "./auth/store.js";
import { cacheAccessToken, forgetAccessToken, NotSignedInError } from "./auth/tokens.js";
import {
  config,
  configPath,
  findProject,
  gatewayUrl,
  projects,
  removeProject,
  upsertProject,
} from "./config.js";
import { connect } from "./connection.js";

const VERSION = "0.1.0";

const program = new Command()
  .name("exeora")
  .description("Connect AI agents to the development environment on this machine.")
  .version(VERSION);

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
      p.outro("Next: `exeora device register`");
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
        cliVersion: VERSION,
      });

      config.set("deviceId", registered.id);
      config.set("deviceName", registered.name);
      p.log.success(`Registered ${registered.name} (${registered.id}).`);
      p.log.info("Next: `exeora project add .`");
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
      p.log.info("Then run `exeora connect` and leave it running.");
    }),
  );

project
  .command("list")
  .description("List projects registered on this machine")
  .action(
    guard(async () => {
      const local = projects();
      if (local.length === 0) return p.log.info("No projects yet. Run `exeora project add .`");

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
  .command("connect")
  .description("Serve tool calls for this machine's projects (keep running)")
  .action(
    guard(async () => {
      const deviceId = config.get("deviceId");
      if (!deviceId) {
        p.log.error("This machine is not registered. Run `exeora device register` first.");
        process.exitCode = 1;
        return;
      }
      if (projects().length === 0) {
        p.log.warn("No projects registered on this machine yet. Run `exeora project add .`");
      }

      p.intro(`Exeora: ${config.get("deviceName") ?? deviceId}`);
      p.log.info(`Gateway: ${gatewayUrl()}`);
      p.log.info("Press Ctrl+C to stop.\n");

      const connection = connect(deviceId, {
        onOpen: () => p.log.success("Connected. Waiting for tool calls."),
        onClose: (reason) => p.log.warn(reason),
        onError: (message) => p.log.error(message),
        onCall: (tool, slug) => p.log.message(`→ ${tool} (${slug})`),
        onResult: (tool, ok, ms) => p.log.message(`${ok ? "✓" : "✗"} ${tool} ${ms}ms`),
      });

      const stop = () => connection.stop();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);

      await connection.closed;
      p.outro("Disconnected.");
    }),
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
          `Signed in ${error instanceof NotSignedInError ? "not signed in, run `exeora login`" : "unknown"}`,
        );
        return;
      }

      const local = projects();
      p.log.message(`Projects  ${local.length === 0 ? "none" : ""}`);
      for (const entry of local) {
        const known = findProject(entry.id) ? "" : " (unknown to the gateway)";
        p.log.message(`  ${pad(entry.slug, 18)} ${entry.root}${known}`);
      }
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

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

program.parseAsync(process.argv);

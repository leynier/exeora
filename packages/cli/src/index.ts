#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  agentPrompt,
  type CommandPolicy,
  type LocalCommandPolicy,
  narrowPolicy,
  POLICY_MODES,
} from "@exeora/protocol";
import { Command } from "commander";
import { gateway, type ToolCallView } from "./api.js";
import { login } from "./auth/login.js";
import { clearCredentials, usingFileFallback } from "./auth/store.js";
import { cacheAccessToken, forgetAccessToken, NotSignedInError } from "./auth/tokens.js";
import {
  config,
  configPath,
  DEFAULT_GATEWAY,
  forgetLocalState,
  gatewaySource,
  gatewayUrl,
  projects,
  removeProject,
  upsertProject,
} from "./config.js";
import { connect } from "./connection.js";
import { normalizeGateway, switchGateway } from "./gateway.js";
import { describePolicy, fromFlags, renderPolicyToml, splitList } from "./init.js";
import { decideDevice, prepare, slugify } from "./onboard.js";
import { POLICY_FILENAME } from "./policy.js";
import { interactive, maybeAskForStar } from "./star.js";
import { reconcile } from "./sync.js";
import { CLI_VERSION } from "./version.js";

const program = new Command()
  .name("exeora")
  .description(
    "Connect AI agents to the development environment on this machine, wherever it runs.",
  )
  .version(CLI_VERSION, "-v, --version")
  .option("--json", "Print machine-readable output instead of drawing on the terminal");

/**
 * Whether this invocation asked for machine-readable output.
 *
 * A global flag rather than one per command, because the reason to want it is
 * global: something other than a person is reading. Read through `program`
 * rather than passed down, so adding it to a command is one branch and not a
 * parameter through every call.
 */
function asJson(): boolean {
  return program.opts().json === true;
}

/** One JSON document on stdout, which is the whole point of `--json`. */
function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

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

// ---------------------------------------------------------------------------

program
  .command("login")
  .description("Sign in to Exeora in your browser")
  .option("-g, --gateway <url>", "Sign in to this Exeora instead, and remember it")
  .option("-y, --yes", "Do not ask before switching gateway")
  .action(
    guard(async (options: { gateway?: string; yes?: boolean }) => {
      p.intro("Exeora");
      if (!(await useGateway(options))) return;

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
      p.log.success(
        `Signed out of ${gatewayUrl()}. The device is still registered; revoke it in the dashboard.`,
      );
    }),
  );

// ---------------------------------------------------------------------------

/** What to do once the gateway has changed and nothing is registered on it. */
const CONNECT_NEXT = "Run `exeora connect` to sign in and register this machine.";

/**
 * Which Exeora this install talks to.
 *
 * The gateway is open source, so the hosted one is a default and not an
 * address. Every URL the CLI builds is rooted at whatever this holds, which is
 * why changing it is a command of its own rather than a setting buried in
 * `connect`.
 */
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

      if (asJson()) {
        return emit(
          devices.map((entry) => ({
            ...entry,
            online: online(entry.lastSeenAt),
            thisMachine: entry.id === config.get("deviceId"),
          })),
        );
      }

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

// ---------------------------------------------------------------------------

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
          onClose: (reason) => (asJson() ? event({ event: "close", reason }) : p.log.warn(reason)),
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
            ...(signedOut ? {} : { error: error instanceof Error ? error.message : String(error) }),
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

program
  .command("init [path]")
  .description(`Write an ${POLICY_FILENAME} restricting what agents may do in a directory`)
  .option("-m, --mode <mode>", `One of ${POLICY_MODES.join(", ")}`)
  .option("-a, --allow <commands>", "Commands to permit, comma separated")
  .option("-d, --deny <commands>", "Commands to refuse, comma separated")
  .option("-t, --tools <tools>", "Tools to offer, comma separated")
  .option("-y, --yes", "Take the flags as given and ask nothing")
  .option("-f, --force", `Overwrite an existing ${POLICY_FILENAME}`)
  .action(
    guard(
      async (
        path: string | undefined,
        options: {
          mode?: string;
          allow?: string;
          deny?: string;
          tools?: string;
          yes?: boolean;
          force?: boolean;
        },
      ) => {
        const root = resolve(path ?? ".");
        const file = join(root, POLICY_FILENAME);

        if (existsSync(file) && !options.force) {
          throw new Error(
            `${file} already exists. Pass --force to replace it, or edit it by hand.`,
          );
        }

        const local = options.yes
          ? fromFlags(options)
          : await askForPolicy(fromFlags(options), root);

        await writeFile(file, renderPolicyToml(local), "utf8");

        // The other half of the answer. Written before it is shown, so what
        // gets combined is the file that now exists rather than a draft.
        const effective = await effectivePolicyFor(root, local);

        if (asJson()) return emit({ path: file, policy: local, effective: effective ?? null });

        p.log.success(`Wrote ${file}.`);

        if (effective) {
          p.note(describePolicy(effective).join("\n"), "What this project will actually allow");
        }

        // Said either way. Someone writing `mode = "allow_all"` here and
        // expecting it to widen something is the misunderstanding worth heading
        // off, and it is the one this file cannot correct on its own.
        p.log.info(
          "This file can only narrow what the project's policy already allows, never widen it. " +
            "It takes effect on the next tool call.",
        );
      },
    ),
  );

program
  .command("prompt")
  .description("Print the Exeora coding-agent prompt, for a client that cannot fetch it itself")
  .option("-a, --account", "The variant for the account URL, which reaches several projects")
  .action(
    guard(async (options: { account?: boolean }) => {
      // Every client that speaks MCP already gets this over the wire, as the
      // handshake instructions, the `coding_agent` prompt and the
      // `get_agent_prompt` tool. This command is for the ones that do not ask:
      // a custom GPT with a system prompt box, an agent framework being wired
      // up by hand, a project's own AGENTS.md.
      const text = agentPrompt({ account: options.account === true });

      // Straight to stdout rather than through `p.log`, because the whole point
      // is that it pipes: `exeora prompt | pbcopy`, `> AGENTS.md`. Anything
      // drawn around it would end up in the file.
      if (asJson()) return emit({ prompt: text });
      process.stdout.write(`${text}\n`);
    }),
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

// ---------------------------------------------------------------------------

/**
 * Applies a `--gateway` flag, or does nothing when there was none.
 *
 * Returns whether the command may carry on, which is a no exactly when the
 * switch was offered and turned down. The flag persists the choice rather than
 * applying it for one run: the one-run version already exists as
 * `EXEORA_GATEWAY_URL`, and it was the missing persistent one that made a
 * self-hosted gateway awkward to live with.
 */
async function useGateway(options: {
  gateway?: string | undefined;
  yes?: boolean | undefined;
}): Promise<boolean> {
  if (!options.gateway) return true;

  const target = normalizeGateway(options.gateway);
  const override = process.env.EXEORA_GATEWAY_URL;

  // Two contradictory instructions in one invocation. Storing the flag and then
  // quietly serving the variable's gateway instead would do neither.
  if (override && originOf(override) !== target) {
    throw new Error(
      `--gateway says ${target}, but EXEORA_GATEWAY_URL says ${override} and the variable wins. ` +
        "Unset it, or drop the flag.",
    );
  }

  return await changeGateway(options.gateway, { yes: options.yes });
}

/** Switches, reports it, and says whether the caller may continue. */
async function changeGateway(
  url: string,
  options: { yes?: boolean | undefined; force?: boolean | undefined; nextStep?: string },
): Promise<boolean> {
  const outcome = await switchGateway({
    input: url,
    yes: options.yes,
    force: options.force,
    json: asJson(),
  });

  if (asJson()) {
    emit({ gateway: outcome.target, source: gatewaySource(), outcome: outcome.kind });
    return outcome.kind !== "declined";
  }

  if (outcome.kind === "unchanged") p.log.info(`Already using ${outcome.target}.`);
  else if (outcome.kind === "declined") p.log.info("Left the gateway as it was.");
  else {
    p.log.success(`Now using ${outcome.target}.`);
    if (options.nextStep) p.log.info(options.nextStep);

    // The change is on disk either way, but this shell will not act on it.
    if (gatewaySource() === "env") {
      p.log.warn(
        `EXEORA_GATEWAY_URL is set to ${process.env.EXEORA_GATEWAY_URL} here and wins over the ` +
          "stored value, so nothing changes until it is unset.",
      );
    }
  }

  return outcome.kind !== "declined";
}

/**
 * The origin of a string that ought to be a gateway, or the string itself.
 *
 * Only used to compare two configured values. A malformed `EXEORA_GATEWAY_URL`
 * is a problem on its own and will be reported by whatever tries to use it;
 * failing here would blame the flag for it.
 */
function originOf(value: string): string {
  try {
    return normalizeGateway(value);
  } catch {
    return value;
  }
}

function describeSource(source: ReturnType<typeof gatewaySource>): string {
  if (source === "env") return "from EXEORA_GATEWAY_URL";
  return source === "default" ? "default" : "configured";
}

/**
 * What a project will actually allow, once this file narrows the account's
 * policy, or nothing when that cannot be worked out.
 *
 * Best effort on purpose. Writing an `exeora.toml` is a local act and has to
 * work on a machine that is not signed in, on a directory that is not a
 * registered project yet, and with the gateway unreachable. In all three there
 * is simply nothing to combine, and the file is no less correct for it.
 */
async function effectivePolicyFor(
  root: string,
  local: LocalCommandPolicy,
): Promise<CommandPolicy | undefined> {
  const here = projects().find((entry) => entry.root === root);
  if (!here) return undefined;

  try {
    const remote = (await gateway.listProjects()).find((entry) => entry.id === here.id);
    return remote ? narrowPolicy(remote.policy, local) : undefined;
  } catch {
    // Not signed in, or the gateway is not reachable. Neither is a reason to
    // fail a command whose work is already done on disk.
    return undefined;
  }
}

/** Fills in what the flags did not say, by asking. */
async function askForPolicy(draft: LocalCommandPolicy, root: string): Promise<LocalCommandPolicy> {
  p.intro(`${POLICY_FILENAME} in ${root}`);

  const mode =
    draft.mode ??
    (await p.select({
      message: "What may an agent do here?",
      initialValue: "allow_list" as (typeof POLICY_MODES)[number],
      options: [
        { value: "allow_list" as const, label: "Only the commands I name", hint: "recommended" },
        { value: "read_only" as const, label: "Read, never change anything" },
        { value: "allow_all" as const, label: "Anything the account allows" },
      ],
    }));

  if (p.isCancel(mode)) {
    p.cancel("Nothing written.");
    process.exit(0);
  }

  const next: LocalCommandPolicy = { ...draft, mode };

  if (mode === "allow_list" && next.allow === undefined) {
    const allow = await p.text({
      message: "Commands to permit, comma separated",
      placeholder: "npm, git *, cargo build *",
      defaultValue: "",
    });
    if (p.isCancel(allow)) {
      p.cancel("Nothing written.");
      process.exit(0);
    }
    if (allow.trim()) next.allow = splitList(allow);
  }

  if (mode !== "read_only" && next.deny === undefined) {
    const deny = await p.text({
      message: "Commands to refuse, comma separated (checked before the list above)",
      placeholder: "sudo, rm *",
      defaultValue: "",
    });
    if (p.isCancel(deny)) {
      p.cancel("Nothing written.");
      process.exit(0);
    }
    if (deny.trim()) next.deny = splitList(deny);
  }

  p.outro("Writing it now.");
  return next;
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

/**
 * Turns a thrown error into one readable line instead of a stack trace.
 *
 * Under `--json` it becomes a document on stderr rather than stdout, so a
 * caller piping stdout into a parser gets either valid JSON or nothing, never
 * an error message where a result was expected. The exit code says which.
 */
function guard<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (asJson()) process.stderr.write(`${JSON.stringify({ error: message })}\n`);
      else p.log.error(message);
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
 * The one URL that covers every project, mentioned wherever a project's own is
 * printed.
 *
 * Built from the configured gateway rather than hard-coded, so it points at
 * localhost during development exactly as the per-project URLs do.
 */
function accountMcpUrl(): string {
  return new URL("/mcp", gatewayUrl()).toString();
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

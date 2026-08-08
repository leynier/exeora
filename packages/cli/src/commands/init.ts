import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  type CommandPolicy,
  type LocalCommandPolicy,
  narrowPolicy,
  POLICY_MODES,
} from "@exeora/protocol";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { projects } from "../config.js";
import { describePolicy, fromFlags, renderPolicyToml, splitList } from "../init.js";
import { asJson, emit, guard } from "../output.js";
import { POLICY_FILENAME } from "../policy.js";

/** Writing the file that restricts what agents may do in a directory. */
export function register(program: Command): void {
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

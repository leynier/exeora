import { homedir, hostname } from "node:os";
import { basename, parse, resolve } from "node:path";
import * as p from "@clack/prompts";
import { type DeviceView, gateway, type ProjectView } from "./api.js";
import { login } from "./auth/login.js";
import { usingFileFallback } from "./auth/store.js";
import { cacheAccessToken, NotSignedInError } from "./auth/tokens.js";
import { config, configPath, type ProjectEntry, projects, upsertProject } from "./config.js";
import { CLI_VERSION } from "./version.js";

/**
 * Everything `connect` has to be true before it can serve: a session, a
 * registered machine, and this directory registered as a project.
 *
 * Each step is skipped when it is already done, so running `connect` twice
 * costs two API calls and nothing else. The separate `login`, `device register`
 * and `project add` commands still exist and do the same work; they are just no
 * longer something a first-time user has to know about.
 */

export class RevokedDeviceError extends Error {
  constructor(name: string) {
    super(
      `This machine (${name}) was revoked from the dashboard, so it will not serve tool calls. ` +
        "Run `exeora connect --reset` to register it again.",
    );
    this.name = "RevokedDeviceError";
  }
}

export interface Prepared {
  deviceId: string;
  deviceName: string;
  /** The project for the directory `connect` was run in, when one was wanted. */
  project: ProjectEntry | null;
}

export async function prepare(options: {
  /** Directory to serve. Defaults to the working directory. */
  path?: string | undefined;
  /** Skip registering the directory and serve what is already registered. */
  add: boolean;
  /** Forget the stored machine and register a fresh one. */
  reset: boolean;
  name?: string | undefined;
  slug?: string | undefined;
}): Promise<Prepared> {
  const root = options.add ? projectRoot(options.path) : null;

  if (options.reset) {
    config.delete("deviceId");
    config.delete("deviceName");
  }

  // One call that proves the session works and answers the device question.
  // Signing in is the only reason it would fail with anything recoverable.
  const devices = await withSignIn(() => gateway.listDevices());

  const device = await ensureDevice(devices, options.name);
  const project = root === null ? null : await ensureProject(root, device.id, options.slug);

  return { deviceId: device.id, deviceName: device.name, project };
}

/**
 * Runs an authenticated call, signing in first if there is no usable session.
 *
 * The sign-in is driven by the call failing rather than by inspecting stored
 * credentials, so an expired or revoked refresh token takes the same path as
 * never having signed in at all.
 */
async function withSignIn<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof NotSignedInError)) throw error;

    const spinner = p.spinner();
    spinner.start("Waiting for the browser…");
    try {
      const result = await login();
      cacheAccessToken(result.accessToken, result.expiresAt);
      const user = await gateway.me();
      spinner.stop(`Signed in as ${user.email}`);
    } catch (cause) {
      spinner.stop("Sign-in failed");
      throw cause;
    }

    if (usingFileFallback()) {
      p.log.warn(
        `No system keychain available, so the session is stored in a 0600 file under ${configPath().replace(/config\.json$/, "")}.`,
      );
    }

    return await call();
  }
}

export type DeviceDecision =
  | { kind: "use"; id: string; name: string }
  | { kind: "register" }
  | { kind: "revoked"; name: string };

/**
 * What to do about this machine, given what the gateway knows.
 *
 * Pure, and separate from acting on it, because the branch that matters is the
 * one that is hardest to reach by hand: a machine revoked from the dashboard
 * must not quietly re-register on the next `connect`, or the dashboard's stop
 * button is only a suggestion.
 */
export function decideDevice(storedId: string | undefined, devices: DeviceView[]): DeviceDecision {
  const known = storedId ? devices.find((device) => device.id === storedId) : undefined;

  // Either nothing was stored, or the stored id belongs to an account or a
  // database this gateway no longer has. Neither of those is a revocation.
  if (!known) return { kind: "register" };
  if (known.revokedAt !== null) return { kind: "revoked", name: known.name };

  return { kind: "use", id: known.id, name: known.name };
}

async function ensureDevice(
  devices: DeviceView[],
  name: string | undefined,
): Promise<{ id: string; name: string }> {
  const decision = decideDevice(config.get("deviceId"), devices);

  if (decision.kind === "revoked") throw new RevokedDeviceError(decision.name);

  if (decision.kind === "use") {
    config.set("deviceName", decision.name);
    return { id: decision.id, name: decision.name };
  }

  const registered = await gateway.registerDevice({
    name: name ?? hostname(),
    platform: process.platform,
    cliVersion: CLI_VERSION,
  });

  config.set("deviceId", registered.id);
  config.set("deviceName", registered.name);
  p.log.success(`Registered this machine as ${registered.name}.`);

  return registered;
}

/**
 * Whether the gateway's record for this directory is already correct.
 *
 * Existing is not enough: the record also has to point at *this* machine and
 * at *this* path. A project registered before `--reset`, or one whose directory
 * has moved, still resolves and still answers, but it routes tool calls to a
 * device that is not the one now connected, so every call fails as offline.
 */
export function projectIsCurrent(
  local: ProjectEntry,
  remote: ProjectView[],
  deviceId: string,
  root: string,
): boolean {
  const record = remote.find((entry) => entry.id === local.id);
  return record !== undefined && record.deviceId === deviceId && record.localPath === root;
}

async function ensureProject(
  root: string,
  deviceId: string,
  requestedSlug: string | undefined,
): Promise<ProjectEntry> {
  const remote = await gateway.listProjects();
  const local = projects().find((entry) => entry.root === root);

  if (local && projectIsCurrent(local, remote, deviceId, root)) return local;

  // Reusing the slug this directory already has is what keeps the project
  // id, and therefore the MCP URL already pasted into a client, stable
  // across a --reset or a move: the gateway upserts by slug.
  const slug = requestedSlug ?? local?.slug ?? uniqueSlug(basename(root), root, remote);
  const added = await gateway.addProject({ deviceId, name: basename(root), slug, localPath: root });
  const entry: ProjectEntry = { id: added.id, slug: added.slug, name: added.name, root };

  upsertProject(entry);
  p.log.success(`Serving ${entry.name} from ${root}.`);

  return entry;
}

/**
 * A slug free for this directory.
 *
 * Slugs are unique per account, and two checkouts called `api` on different
 * machines are ordinary. Reusing the slug would quietly repoint the existing
 * project's URL at this directory, so a suffix is added instead.
 */
export function uniqueSlug(name: string, root: string, remote: ProjectView[]): string {
  const base = slugify(name);
  const taken = new Set(
    remote.filter((entry) => entry.localPath !== root).map((entry) => entry.slug),
  );

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/**
 * The directory to serve, refusing the two that are almost always a slip.
 *
 * A project is the confinement boundary for every tool, so handing an agent
 * `$HOME` or `/` gives away the whole machine. Someone who genuinely means it
 * can still say so with an explicit path to a subdirectory.
 */
export function projectRoot(path: string | undefined): string {
  const root = resolve(path ?? ".");

  if (root === homedir()) {
    throw new Error(
      "That is your home directory, and a project is the boundary an agent is confined to. " +
        "Run this inside the directory you want to serve.",
    );
  }
  if (root === parse(root).root) {
    throw new Error(
      "That is the filesystem root, and a project is the boundary an agent is confined to. " +
        "Run this inside the directory you want to serve.",
    );
  }

  return root;
}

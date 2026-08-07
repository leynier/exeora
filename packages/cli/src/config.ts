import Conf from "conf";

/**
 * Non-secret local state: which gateway, which device, which projects.
 *
 * The refresh token deliberately lives elsewhere (`auth/store.ts`), in the OS
 * keychain, so this file can stay readable and inspectable.
 */

export interface ProjectEntry {
  id: string;
  slug: string;
  name: string;
  /** Absolute path on this machine. The executor's authority on the root. */
  root: string;
}

/**
 * What is left of the one favour the CLI ever asks for.
 *
 * Kept here rather than in `star.ts` because it is state about this machine
 * like any other, and because a reader who opens `config.json` to see what
 * Exeora remembers about them deserves to find it in plain sight.
 */
export interface StarPrompt {
  /** Interactive runs seen so far. */
  runs: number;
  /** The run number from which the question may be put on screen. */
  askAt: number;
  /** How many times it actually was. */
  asked: number;
  /** Nothing left to do: already starred, or turned down twice. */
  done: boolean;
}

interface Schema {
  gatewayUrl: string;
  deviceId?: string;
  deviceName?: string;
  projects: ProjectEntry[];
  star: StarPrompt;
}

/** Where the published CLI talks unless it is told otherwise. */
export const DEFAULT_GATEWAY = "https://exeora.dev";

export const config = new Conf<Schema>({
  projectName: "exeora",
  defaults: {
    gatewayUrl: process.env.EXEORA_GATEWAY_URL ?? DEFAULT_GATEWAY,
    projects: [],
    star: { runs: 0, askAt: 3, asked: 0, done: false },
  },
});

export function gatewayUrl(): string {
  // The env var wins at call time too, so pointing a shell at a local gateway
  // does not permanently rewrite the stored configuration.
  return process.env.EXEORA_GATEWAY_URL ?? config.get("gatewayUrl");
}

/**
 * Which of the three possible answers `gatewayUrl()` just gave.
 *
 * Worth reporting because the environment variable silently outranks the stored
 * value: without this, someone with `EXEORA_GATEWAY_URL` exported in their
 * shell would run `exeora gateway use` and watch it appear to do nothing.
 */
export function gatewaySource(): "env" | "config" | "default" {
  if (process.env.EXEORA_GATEWAY_URL) return "env";
  return config.get("gatewayUrl") === DEFAULT_GATEWAY ? "default" : "config";
}

export function setGatewayUrl(url: string): void {
  config.set("gatewayUrl", url);
}

/**
 * Forget which machine and which directories this install was serving.
 *
 * Both callers reach it the same way: something on the other end no longer
 * knows about them. The dashboard deleted the machine, or the gateway itself
 * changed, and in either case the ids left here address a record that does not
 * exist. Keeping them would send every tool call to a device the new gateway
 * has never heard of.
 */
export function forgetLocalState(): void {
  config.delete("deviceId");
  config.delete("deviceName");
  config.set("projects", []);
}

export function projects(): ProjectEntry[] {
  return config.get("projects");
}

export function findProject(id: string): ProjectEntry | undefined {
  return projects().find((project) => project.id === id);
}

export function upsertProject(entry: ProjectEntry): void {
  const existing = projects().filter((project) => project.id !== entry.id);
  config.set("projects", [...existing, entry]);
}

export function removeProject(id: string): void {
  config.set(
    "projects",
    projects().filter((project) => project.id !== id),
  );
}

export function configPath(): string {
  return config.path;
}

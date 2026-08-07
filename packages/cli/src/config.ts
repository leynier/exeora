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

const DEFAULT_GATEWAY = "https://exeora.dev";

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

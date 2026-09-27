import type { State } from "./api-types.js";

/**
 * The one vocabulary of states, and how each of them is drawn.
 *
 * The gateway decides the state; this only decides the tone. It lives apart
 * from the component so the mapping can be tested without a DOM, and so a
 * filter or a sentence can use the same words the badge does.
 */

export type StateTone = "neutral" | "success" | "error" | "brand";

export interface StateView {
  label: string;
  tone: StateTone;
  /** Whether something is answering right now, which is what the dot pulses for. */
  live: boolean;
  /** What the word means, for the tooltip and for whoever has not met it yet. */
  meaning: string;
}

const VIEWS: Record<State, Omit<StateView, "label">> = {
  online: { tone: "success", live: true, meaning: "Connected and answering calls." },
  asleep: {
    tone: "neutral",
    live: false,
    meaning: "Paused while idle. The next call wakes it, which takes a moment.",
  },
  offline: {
    tone: "neutral",
    live: false,
    meaning: "Not connected. Run `exeora connect` on the machine.",
  },
  "setting up": { tone: "brand", live: false, meaning: "Being prepared. Nothing to do but wait." },
  failed: { tone: "error", live: false, meaning: "Could not be set up. The row says why." },
  "not cloned": {
    tone: "neutral",
    live: false,
    meaning: "The repository is cloned here when the first workspace is made.",
  },
  "no instance": {
    tone: "neutral",
    live: false,
    meaning:
      "Exeora Cloud holds no instance for the project root. The next call to it makes one, and so does Start instance.",
  },
  removing: { tone: "neutral", live: false, meaning: "On its way out." },
  removed: { tone: "neutral", live: false, meaning: "Revoked. It no longer answers calls." },
};

/** Every state, in the order a filter lists them. */
export const STATES = Object.keys(VIEWS) as State[];

/**
 * How to draw a state. A word this build has never heard of is shown as it
 * came, in the neutral tone, so a newer gateway is still readable.
 */
export function stateView(state: string): StateView {
  const known = VIEWS[state as State];
  if (known) return { label: state, ...known };
  return { label: state, tone: "neutral", live: false, meaning: "" };
}

/** Whether the Workspace page has something to open: running, or a call away from it. */
export function isReachable(state: string): boolean {
  return state === "online" || state === "asleep";
}

/** Whether the state is one that settles on its own, and so is worth polling for. */
export function isInFlight(state: string): boolean {
  return state === "setting up" || state === "removing";
}

/**
 * What the provider says an instance is doing, as a hint beside its state.
 *
 * Secondary on purpose: the state is what Exeora knows, this is what the
 * provider reports, and the two can disagree for a moment.
 */
export function runtimeHint(runtime: string | null | undefined): string | null {
  if (runtime === "running") return "running";
  if (runtime === "warm") return "warm, resumes at once";
  if (runtime === "cold") return "cold, resumes in a moment";
  return null;
}

/** A count of instances as the overview says it: `2 running · 1 asleep`. */
export function instanceSummary(states: readonly string[]): string {
  if (states.length === 0) return "none";
  const count = (state: string) => states.filter((entry) => entry === state).length;
  return `${count("online")} running · ${count("asleep")} asleep`;
}

/**
 * The instances the summary leaves out, which are the ones that are neither
 * running nor asleep: `1 failed · 1 setting up`. Empty when there are none.
 */
export function instanceExceptions(states: readonly string[]): string {
  return ["failed", "setting up", "removing"]
    .map((state) => [states.filter((entry) => entry === state).length, state] as const)
    .filter(([count]) => count > 0)
    .map(([count, state]) => `${count} ${state}`)
    .join(" · ");
}

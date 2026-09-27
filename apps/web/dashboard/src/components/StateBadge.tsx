import { stateView } from "../states.js";

const TONES = {
  neutral: { pill: "bg-accent-subtle text-foreground-muted", dot: "bg-foreground-faint/60" },
  success: { pill: "bg-success/12 text-success", dot: "bg-success" },
  error: { pill: "bg-error/12 text-error", dot: "bg-error" },
  brand: { pill: "bg-brand-subtle text-brand", dot: "bg-brand" },
};

/**
 * The state of a location, a machine or an instance, the same everywhere.
 *
 * Every page that shows a state shows it through this, so `asleep` looks and
 * reads the same on the project page as on the Machines page, and nobody has
 * to learn that "sleeping", "ready" and "idle" were one thing. The word is
 * always written out: the colour only repeats it.
 */
export function StateBadge({ state, hint }: { state: string; hint?: string | null }) {
  const view = stateView(state);
  const tone = TONES[view.tone];
  return (
    <span
      className={`text-label-md rounded-pill inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 font-mono uppercase ${tone.pill}`}
      title={view.meaning || undefined}
    >
      <Dot tone={tone.dot} live={view.live} />
      {view.label}
      {hint ? <span className="text-foreground-faint normal-case">· {hint}</span> : null}
    </span>
  );
}

/**
 * The state as a dot, for a chip that has room for a name and nothing else.
 * The word is still there for a screen reader and on hover.
 */
export function StateDot({ state }: { state: string }) {
  const view = stateView(state);
  return (
    <span className="inline-flex shrink-0 items-center" title={view.label}>
      <span className="sr-only">{view.label}</span>
      <Dot tone={TONES[view.tone].dot} live={view.live} />
    </span>
  );
}

function Dot({ tone, live }: { tone: string; live: boolean }) {
  return (
    <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
      {live && (
        <span
          className={`absolute inline-flex size-2 animate-ping rounded-full opacity-60 ${tone}`}
        />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${tone}`} />
    </span>
  );
}

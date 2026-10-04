import { Bot } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PanelRelay, RelayView } from "./relay.js";

/**
 * Whether ChatGPT can move this panel, and the person's way to stop it: a
 * small chip in the header, with Stop while it is on and Resume once it is
 * not. Stopping ends whatever the model asked that is still under way.
 */
export function AgentControl({ relay }: { relay: PanelRelay }) {
  const view = useSyncExternalStore(relay.subscribe, relay.get);
  const { label, tone } = describe(view);
  const on = view.status === "connected" || view.status === "connecting";
  return (
    <section
      aria-label="ChatGPT control"
      title={view.message ?? label}
      className="border-border-subtle flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1"
    >
      <Bot aria-hidden className={`size-4 shrink-0 ${tone}`} />
      <span
        role="status"
        // On a phone the icon's color says all is well; anything else is spelled out.
        className={`text-body-md text-foreground-muted truncate ${on ? "max-sm:sr-only" : ""}`}
      >
        {label}
      </span>
      {view.status === "closed" ? null : view.status === "stopped" ||
        view.status === "unavailable" ? (
        <button type="button" className="btn shrink-0" onClick={relay.resume}>
          {view.status === "stopped" ? "Resume" : "Try again"}
        </button>
      ) : (
        <button
          type="button"
          className="btn shrink-0"
          onClick={relay.stop}
          title={on ? "Stop ChatGPT from moving this panel" : "Stop reconnecting"}
        >
          Stop
        </button>
      )}
    </section>
  );
}

function describe(view: RelayView): { label: string; tone: string } {
  switch (view.status) {
    case "connected":
      return view.busy > 0
        ? { label: "ChatGPT is moving this panel", tone: "text-foreground" }
        : { label: "ChatGPT can move this panel", tone: "text-success" };
    case "connecting":
      return { label: "Connecting ChatGPT control…", tone: "text-foreground-faint" };
    case "reconnecting":
      return { label: "Reconnecting ChatGPT control…", tone: "text-warning" };
    case "stopped":
      return { label: "ChatGPT control stopped", tone: "text-foreground-faint" };
    case "closed":
      return { label: "ChatGPT closed this panel", tone: "text-foreground-faint" };
    case "unavailable":
      return { label: view.message ?? "ChatGPT control is unavailable", tone: "text-error" };
  }
}

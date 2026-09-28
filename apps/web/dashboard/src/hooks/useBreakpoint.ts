import { useSyncExternalStore } from "react";

/** Tailwind's `lg`, where the Workspace screen turns from a phone into a desk. */
const WIDE = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True at `lg` and above. Chrome's side panel never gets there. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

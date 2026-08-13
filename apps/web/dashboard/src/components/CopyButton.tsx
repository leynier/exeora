import { useEffect, useRef, useState } from "react";
import { useToast } from "./toast.js";

/**
 * Copies a string and says so for a moment.
 *
 * The timer is cleared on unmount: these live inside lists that a 15-second
 * refetch can re-render out from under them.
 */
export function CopyButton({
  value,
  label = "Copy",
  className = "btn shrink-0",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useToast();

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={className}
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          setState("failed");
          toast("Clipboard access was refused. Select and copy the text manually.", "error");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), 2000);
          return;
        }
        setState("copied");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

import { useEffect, useRef, useState } from "react";

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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          return; // No clipboard permission: better to do nothing than to claim success.
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

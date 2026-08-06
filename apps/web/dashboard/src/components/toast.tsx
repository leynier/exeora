import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/**
 * Transient confirmations, for actions whose result is otherwise invisible.
 *
 * Revoking a machine removes a row and closes a socket somewhere else; without
 * a word the user is left guessing whether the click registered.
 */

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error";
}

const ToastContext = createContext<((message: string, tone?: Toast["tone"]) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Announced rather than only shown: the visual cue is off to the side
        // and easy to miss.
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`border-border bg-surface-elevated text-body-md rounded-lg border px-4 py-2.5 shadow-lg ${
              toast.tone === "error" ? "text-error" : "text-foreground"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast used outside ToastProvider");
  return push;
}

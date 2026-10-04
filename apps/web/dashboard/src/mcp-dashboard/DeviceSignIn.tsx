import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { CopyButton } from "../components/CopyButton.js";
import { type DeviceCode, deviceLogin } from "./deviceLogin.js";
import type { SideappSession } from "./session.js";

/** What the sign-in screen needs from the frame it runs in. */
export interface SideappEnv {
  session: SideappSession;
  gateway: string;
  openLink: (url: string) => void;
}

export const SideappContext = createContext<SideappEnv | null>(null);

type Step =
  | { kind: "idle"; error: string | null }
  | { kind: "starting" }
  | { kind: "code"; code: DeviceCode };

/**
 * Signing in to the dashboard inside ChatGPT, with a code.
 *
 * The gateway's sign-in page opens in the browser; the code shown here is
 * entered there, and this screen carries on by itself once it is approved.
 * It is a separate sign-in from the ChatGPT connection, for this account's
 * dashboard only.
 */
export function DeviceSignIn() {
  const env = useContext(SideappContext);
  const location = useLocation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "idle", error: null });
  const running = useRef<AbortController | null>(null);
  const returnTo = useRef("/");

  // Leaving the screen, or signing out, stops the poll.
  useEffect(() => () => running.current?.abort(), []);

  if (!env) return null;
  const { session, gateway, openLink } = env;
  // Where to go once signed in, as it is then: a deep link may arrive meanwhile.
  returnTo.current = (location.state as { from?: string } | null)?.from ?? "/";
  const current = (local: AbortController) => running.current === local && !local.signal.aborted;

  const start = async () => {
    running.current?.abort();
    const local = new AbortController();
    running.current = local;
    const ended = session.signal();
    const stop = () => local.abort();
    ended.addEventListener("abort", stop, { once: true });
    const generation = session.generation();
    setStep({ kind: "starting" });
    try {
      const tokens = await deviceLogin(
        { gateway, fetch: window.fetch.bind(window), signal: local.signal },
        (code) => {
          // A newer attempt, or a cancel, owns the screen now.
          if (!current(local)) return;
          openLink(code.verificationUri);
          setStep({ kind: "code", code });
        },
      );
      if (!current(local) || !session.save(tokens.accessToken, tokens.expiresIn, generation)) {
        return;
      }
      running.current = null;
      navigate(returnTo.current, { replace: true });
    } catch (error) {
      if (!current(local)) return;
      running.current = null;
      setStep({
        kind: "idle",
        error: error instanceof Error ? error.message : "Signing in did not complete.",
      });
    } finally {
      ended.removeEventListener("abort", stop);
    }
  };

  const cancel = () => {
    running.current?.abort();
    running.current = null;
    setStep({ kind: "idle", error: null });
  };

  return (
    <div className="grid min-h-full place-items-center px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="border-border bg-surface rounded-xl border p-7">
          <h1 className="text-headline-sm">Sign in to the Exeora Dashboard</h1>
          <p className="text-body-md text-foreground-muted mt-1.5 mb-6">
            A separate sign-in from ChatGPT's connection, for your own Exeora account: machines,
            projects, clients and settings.
          </p>

          {step.kind === "code" ? (
            <CodeStep
              code={step.code}
              open={() => openLink(step.code.verificationUri)}
              cancel={cancel}
            />
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary w-full py-2.5"
                disabled={step.kind === "starting"}
                onClick={() => void start()}
              >
                {step.kind === "starting" ? "Starting…" : "Sign in with a code"}
              </button>
              {step.kind === "idle" && step.error ? (
                <p role="alert" className="text-body-md text-error mt-4">
                  {step.error}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeStep({
  code,
  open,
  cancel,
}: {
  code: DeviceCode;
  open: () => void;
  cancel: () => void;
}) {
  const left = useCountdown(code.expiresAt);
  return (
    <div className="space-y-4">
      <p className="text-body-md text-foreground-muted">
        Enter this code on the Exeora page that opened in your browser, then approve.
      </p>
      <div className="flex items-center justify-between gap-2">
        <output aria-label="Sign-in code" className="text-headline-sm font-mono tracking-[0.2em]">
          {code.userCode}
        </output>
        <CopyButton value={code.userCode} />
      </div>
      <p className="text-body-md text-foreground-faint" aria-live="polite">
        Waiting for approval · expires in {left}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn flex-1" onClick={open}>
          Open the sign-in page
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function useCountdown(until: number): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((until - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** `/callback` in ChatGPT: there is no redirect to come back from, so it signs in here. */
export function NoCallback() {
  return <Navigate to="/signin" replace />;
}

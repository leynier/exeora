import { useState } from "react";
import { useLocation } from "react-router";
import { beginSignIn } from "../auth.js";

/**
 * The screen that used to be missing.
 *
 * Before this, arriving without a token redirected to GitHub from a blank
 * page, which is both disorienting and impossible to escape from: signing out
 * landed you right back in the redirect. Now sign-in is a click.
 */
export function SignIn() {
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const returnTo = (location.state as { from?: string } | null)?.from ?? "/dashboard/";

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <svg viewBox="0 0 64 64" className="text-brand size-5" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="17" stroke="currentColor" strokeWidth="5" />
            <path d="M32 15a17 17 0 0 0 0 34z" fill="currentColor" />
          </svg>
          <span className="text-title-lg tracking-tight">Exeora</span>
        </div>

        <div className="border-border bg-surface rounded-xl border p-7">
          <h1 className="text-headline-sm">Sign in</h1>
          <p className="text-body-md text-foreground-muted mt-1.5 mb-6">
            Your machines, your projects and what agents have been doing with them.
          </p>

          <button
            type="button"
            className="btn btn-primary w-full py-2.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await beginSignIn(returnTo);
              } catch (cause) {
                setBusy(false);
                setError(cause instanceof Error ? cause.message : "Sign-in could not start.");
              }
            }}
          >
            {busy ? "Redirecting…" : "Continue with GitHub"}
          </button>

          {error && <p className="text-body-md text-error mt-4">{error}</p>}
        </div>

        <p className="text-body-md text-foreground-faint mt-5 text-center">
          <a href="/" className="hover:text-foreground transition-colors duration-fast">
            Back to exeora.dev
          </a>
        </p>
      </div>
    </div>
  );
}

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
          <svg
            viewBox="0 0 62 42"
            className="text-brand h-[15px] w-auto"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="20" y="0" width="22" height="22" rx="2" />
            <rect x="0" y="20" width="22" height="22" rx="2" />
            <rect x="40" y="20" width="22" height="22" rx="2" />
          </svg>
          <span className="text-title-lg tracking-tight">Exeora</span>
        </div>

        <div className="border-border bg-surface rounded-xl border p-7">
          <h1 className="text-headline-sm">Sign in</h1>
          <p className="text-body-md text-foreground-muted mt-1.5 mb-6">
            Your machines, your projects and what agents have been doing with them.
          </p>

          {/* The question this screen actually raises. GitHub is asked for
              `read:user user:email` and nothing more, so saying so is both
              reassuring and true. */}
          <p className="text-body-md text-foreground-faint mb-5">
            GitHub is only used to check that you are you. Exeora reads your name, username and
            email address. It asks for no access to your repositories and never sees your code.
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

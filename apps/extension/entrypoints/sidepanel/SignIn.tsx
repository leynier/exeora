import { useState } from "react";
import { auth, GATEWAY } from "../../lib/session.js";

/**
 * The panel before anyone has signed in, or after the session ended.
 *
 * Signing in opens Chrome's own window on the gateway's sign-in page. The
 * first time on an account it also asks to authorize the extension.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Mark />
      <div>
        <h1 className="text-headline-md">Exeora</h1>
        <p className="text-body-md text-foreground-muted mt-2">
          Sign in to review changes, commit and open terminals in your workspaces from this panel.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await auth.signIn();
            onSignedIn();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Sign-in failed. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Signing in…" : "Sign in with Exeora"}
      </button>
      {error ? <p className="text-body-md text-error">{error}</p> : null}
      <p className="text-label-md text-foreground-faint font-mono">{new URL(GATEWAY).host}</p>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 64 44" width="44" height="30" fill="currentColor" aria-hidden="true">
      <rect x="20" y="0" width="24" height="24" rx="4" />
      <rect x="0" y="20" width="24" height="24" rx="4" />
      <rect x="40" y="20" width="24" height="24" rx="4" />
    </svg>
  );
}

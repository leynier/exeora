import { useEffect, useState } from "react";
import { completeSignIn } from "../auth.js";

/**
 * Where the authorization server sends the browser back.
 *
 * It exchanges the code and then replaces this entry in history, so the back
 * button does not return to a URL whose one-time code has already been spent.
 */
export function Callback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeSignIn(window.location.search)
      .then((returnTo) => {
        window.location.replace(returnTo);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      });
  }, []);

  return (
    <div className="grid min-h-screen place-items-center px-5 text-center">
      {error ? (
        <div className="max-w-sm">
          <h1 className="text-headline-sm">Sign-in failed</h1>
          <p className="text-body-md text-foreground-muted mt-2">{error}</p>
          <a href="/dashboard/" className="btn mt-6">
            Try again
          </a>
        </div>
      ) : (
        <p className="text-body-md text-foreground-muted">Finishing sign-in…</p>
      )}
    </div>
  );
}

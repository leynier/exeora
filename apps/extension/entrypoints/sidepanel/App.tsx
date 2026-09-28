import { useEffect, useState } from "react";
import { SESSION_KEY } from "../../lib/auth.js";
import { auth } from "../../lib/session.js";
import { Panel } from "./Panel.js";
import { SignIn } from "./SignIn.js";

type Status = "loading" | "signed-out" | "signed-in";

/**
 * Signed in or not, read from storage and kept in step with it: signing in or
 * out in one window's panel changes every other window's too, and a refresh
 * the gateway refused clears the session from under whichever panel asked.
 */
export function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const check = () =>
      void auth.isSignedIn().then((signedIn) => setStatus(signedIn ? "signed-in" : "signed-out"));
    check();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && SESSION_KEY in changes) check();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  if (status === "loading") return null;
  if (status === "signed-out") return <SignIn onSignedIn={() => setStatus("signed-in")} />;
  // A session the gateway refuses on refresh is cleared from storage, which
  // brings this back to the sign-in screen through the listener above.
  return <Panel />;
}

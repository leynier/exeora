import { useState } from "react";
import { errorText } from "../api.js";
import { externalHttpsUrl } from "../external-url.js";
import { useGitHub } from "../queries.js";
import { useToast } from "./toast.js";

/**
 * The way out to github.com to connect an account.
 *
 * The address is asked for again at the moment of the click. It carries a
 * signed state that is good for a few minutes, and the one that came with the
 * page may have been sitting there for an hour. It is a complete address on
 * github.com, so the browser is sent to it rather than the router.
 */
export function ConnectGitHubButton({
  className = "btn btn-primary",
  label = "Connect GitHub",
}: {
  className?: string;
  label?: string;
}) {
  const github = useGitHub();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={leaving}
      onClick={async () => {
        setLeaving(true);
        const fresh = await github.refetch();
        const url = fresh.data?.connectUrl;
        const safeUrl = externalHttpsUrl(url);
        if (safeUrl) {
          window.location.assign(safeUrl);
          return;
        }
        setLeaving(false);
        toast(
          fresh.error
            ? errorText(fresh.error, "GitHub could not be reached.")
            : "This gateway has no address to connect GitHub with. Try again in a moment.",
          "error",
        );
      }}
    >
      {leaving ? "Opening GitHub…" : label}
    </button>
  );
}

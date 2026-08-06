import { useState } from "react";
import { api } from "../api.js";
import { signOut } from "../auth.js";
import { useMe } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";

/**
 * Irreversible account actions.
 *
 * Kept on Settings and nowhere else: the one action here that cannot be undone
 * by signing in again takes the machines, the projects, every client's
 * authorization and the whole audit trail, and unregisters the applications
 * that were only ever used from this account.
 *
 * There is no soft delete behind it. An account someone asked to have removed
 * is not a record worth keeping, which is also what makes the typed
 * confirmation worth the friction.
 *
 * Other destructive account-level actions belong in this same section as they
 * appear, so the red border is a reliable signal rather than a one-off style.
 */
export function DangerZone() {
  const me = useMe();
  const toast = useToast();

  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);

  const email = me.data?.email;

  async function remove() {
    setWorking(true);
    try {
      await api.deleteAccount();
      // Straight out, without invalidating anything: there is no account left
      // for a refetched query to describe.
      signOut();
    } catch (error) {
      setWorking(false);
      setAsking(false);
      toast(error instanceof Error ? error.message : "Could not delete the account.");
    }
  }

  return (
    <>
      <section className="border-error/30 bg-surface rounded-xl border p-5">
        <h2 className="text-title-lg text-error">Danger</h2>
        <p className="text-body-md text-foreground-muted mt-1.5">
          These actions are permanent. There is no undo, and no recovery path after they finish.
        </p>

        <div className="border-error/20 mt-5 border-t pt-5">
          <h3 className="text-title-md">Delete this account</h3>
          <p className="text-body-md text-foreground-muted mt-1.5">
            Removes every machine, project and authorization, along with the whole activity log. Any
            CLI still running loses its connection at once. This cannot be undone.
          </p>

          <button
            type="button"
            className="btn btn-danger mt-4"
            disabled={!email}
            onClick={() => setAsking(true)}
          >
            Delete account
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={asking}
        title="Delete this account?"
        body="Every machine is cut off, every project and authorization is removed, and the activity log goes with them. There is no way back."
        confirmLabel="Delete account"
        confirmText={email}
        pending={working}
        onConfirm={remove}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}

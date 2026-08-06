import { useState } from "react";
import { api } from "../api.js";
import { signOut } from "../auth.js";
import { useMe } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";

/**
 * Deleting the account.
 *
 * Kept at the bottom of the overview and nowhere else, because it is the one
 * action here that cannot be undone by signing in again: it takes the machines,
 * the projects, every client's authorization and the whole audit trail, and
 * unregisters the applications that were only ever used from this account.
 *
 * There is no soft delete behind it. An account someone asked to have removed
 * is not a record worth keeping, which is also what makes the typed
 * confirmation worth the friction.
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
      <section className="border-error/30 bg-surface mt-8 rounded-xl border p-5">
        <h2 className="text-title-lg">Delete this account</h2>
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorText, relativeTime } from "../api.js";
import { keys, useExtension } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";
import { Badge, Card, Row } from "./ui.js";

/**
 * Exeora for Chrome: whether this account approved it, how many side panels
 * are signed in, and the one way to end all of them from here.
 *
 * Drawn only once the account has approved it, and not at all on a gateway
 * that names no extension: there is nothing to revoke before either.
 */
export function ExtensionCard({ className = "" }: { className?: string }) {
  const extension = useExtension();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: api.revokeExtension,
    onSuccess: () => {
      toast("Exeora for Chrome is signed out everywhere. It will ask for consent again.");
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: keys.extension });
    },
    onError: (error) => {
      toast(errorText(error, "Exeora for Chrome could not be revoked."), "error");
      setConfirming(false);
    },
  });

  const status = extension.data;
  if (!status?.enabled || (status.since === null && status.sessions === 0)) return null;

  return (
    <>
      <Card
        title="Exeora for Chrome"
        subtitle="The side panel that opens your workspaces next to any tab."
        className={className}
      >
        <Row>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-title-md">
                {status.sessions === 1
                  ? "1 signed-in browser"
                  : `${status.sessions} signed-in browsers`}
              </p>
              {status.sessions > 0 && <Badge tone="success">connected</Badge>}
            </div>
            <p className="text-body-md text-foreground-faint">
              {status.since === null
                ? "Not approved on this account."
                : `Approved ${relativeTime(status.since)}. Revoking signs every browser out and asks for consent again.`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger shrink-0"
            disabled={revoke.isPending}
            onClick={() => setConfirming(true)}
          >
            Revoke
          </button>
        </Row>
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Revoke Exeora for Chrome?"
        body="Every side panel signed in to this account is signed out. Signing in again asks for consent."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => revoke.mutate()}
      />
    </>
  );
}

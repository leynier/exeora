import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlreadyAnswered, type Approval, api } from "../api.js";
import { keys, useApprovals } from "../queries.js";
import { useToast } from "./toast.js";

/**
 * Calls waiting on an answer, at the top of every screen.
 *
 * This is the half of confirmation that reaches the clients people actually
 * use. A project set to confirm every change can only be asked over MCP by a
 * client speaking 2026-07-28, which today is neither claude.ai nor ChatGPT;
 * everything else is asked here, or in the terminal running `exeora connect`.
 *
 * Above the navigation rather than on a screen of its own, because there is an
 * AI client holding a request open at the other end and ninety seconds to
 * answer in. A question you have to go and look for is one that expires.
 */
export function ApprovalBanner() {
  const approvals = useApprovals();
  const pending = approvals.data ?? [];

  if (pending.length === 0) return null;

  return (
    <div className="border-accent/40 bg-accent-subtle border-b">
      <div className="mx-auto max-w-5xl space-y-3 px-5 py-4">
        {pending.map((approval) => (
          <ApprovalRow key={approval.id} approval={approval} />
        ))}
      </div>
    </div>
  );
}

function ApprovalRow({ approval }: { approval: Approval }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answering, setAnswering] = useState(false);

  async function answer(approved: boolean) {
    setAnswering(true);
    try {
      await api.answerApproval(approval.id, approval.deviceId, approved);
      toast(approved ? "Allowed. It is running now." : "Refused.");
    } catch (error) {
      // The terminal answered first, which is a race rather than a failure:
      // both places are asked at once, on purpose, and either may win.
      toast(
        error instanceof AlreadyAnswered
          ? "That was answered somewhere else."
          : error instanceof Error
            ? error.message
            : "Could not answer.",
      );
    } finally {
      // Either way the question is gone, and the audit log has a new row.
      await queryClient.invalidateQueries({ queryKey: keys.approvals });
      await queryClient.invalidateQueries({ queryKey: keys.allCalls });
      setAnswering(false);
    }
  }

  const where = [approval.deviceName, approval.clientName].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {/* The command or the file, not "approve this change": a prompt with
            nothing in it is one people learn to click through. */}
        <p className="text-title-md break-words">{approval.prompt}</p>
        <p className="text-body-md text-foreground-muted mt-0.5">
          {where}
          <span className="text-foreground-faint"> · expires in {secondsLeft(approval)}s</span>
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn" disabled={answering} onClick={() => answer(false)}>
          Refuse
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={answering}
          onClick={() => answer(true)}
        >
          Allow
        </button>
      </div>
    </div>
  );
}

/**
 * Rounded down and never negative.
 *
 * Recomputed on each poll rather than ticked by a timer of its own: the list
 * refreshes every three seconds anyway, and a second timer would be a second
 * thing to get wrong for a number nobody reads to the digit.
 */
function secondsLeft(approval: Approval): number {
  return Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000));
}

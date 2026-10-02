import { ApiError } from "../../api.js";
import type {
  ChatgptAccount,
  ChatgptLoginError,
  ChatgptLoginMode,
  ChatgptState,
  ChatgptStatus,
} from "../../api-ai.js";
import { externalHttpsUrl } from "../../external-url.js";

/** The only external destination the ChatGPT plan UI needs after a login. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * The gateway returns an authorize URL from the local CLI. Keep this check at
 * the last possible boundary before rendering an anchor: a malformed URL must
 * never become a browser navigation, and the dashboard must never open a URL
 * carrying the CLI-only id_token_hint.
 */
export function chatgptAuthorizeUrl(value: string | null | undefined): string | undefined {
  const safe = externalHttpsUrl(value);
  if (!safe) return undefined;
  try {
    const url = new URL(safe);
    if (
      url.origin !== "https://auth.openai.com" ||
      url.pathname !== "/api/accounts/authorize" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return undefined;
    }
    if (url.searchParams.has("id_token_hint")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function chatgptErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

export type ChatgptMachineAvailability = "offline" | "update" | "unavailable" | "status_error";

export function chatgptMachineAvailability(error: unknown): ChatgptMachineAvailability {
  switch (chatgptErrorCode(error)) {
    case "ai_machine_offline":
      return "offline";
    case "ai_update_cli":
      return "update";
    case "ai_chatgpt_unavailable_on_cloud":
      return "unavailable";
    default:
      return "status_error";
  }
}

export function chatgptAccountLabel(account: ChatgptAccount | null | undefined): string | null {
  if (!account) return null;
  return account.label || account.email || null;
}

/** Statuses for which a local project target can either generate or recover its login. */
export function chatgptStatusIsActionable(status: ChatgptStatus | null | undefined): boolean {
  return (
    status?.state === "signed_out" ||
    status?.state === "pending" ||
    status?.state === "ready" ||
    status?.state === "plan_disabled" ||
    status?.state === "reconnect" ||
    status?.state === "client_invalid"
  );
}

/** Settings need a usable or signed-out registration; reconnect states only need recovery. */
export function chatgptStatusCanConfigure(status: ChatgptStatus | null | undefined): boolean {
  return (
    status?.state === "signed_out" || status?.state === "ready" || status?.state === "plan_disabled"
  );
}

/** Reuse a saved registration after sign-out; only a missing/invalid registration is new. */
export function chatgptLoginModeForStatus(
  status: ChatgptStatus | null | undefined,
): ChatgptLoginMode {
  if (status?.state === "client_invalid" || status?.loginError === "client_invalid") return "new";
  if (status?.state === "reconnect" || status?.account) return "reauth";
  return "new";
}

export function chatgptStateCopy(state: ChatgptState, machineName: string): string {
  switch (state) {
    case "signed_out":
      return `Use your ChatGPT plan for commit messages and pull requests on ${machineName}.`;
    case "pending":
      return `Open ChatGPT sign-in on ${machineName}.`;
    case "ready":
      return "Plan usage allowed.";
    case "plan_disabled":
      return "You signed in but did not allow plan usage.";
    case "reconnect":
      return "ChatGPT no longer accepts this machine's session.";
    case "client_invalid":
      return "This machine's ChatGPT registration is no longer valid.";
    case "unavailable_on_cloud":
      return "Not available on Exeora Cloud machines.";
  }
}

/**
 * Login failures are a static protocol enum. Keep provider details out of the
 * dashboard while giving each failure a useful next action.
 */
export function chatgptLoginErrorCopy(error: ChatgptLoginError): string {
  switch (error) {
    case "login_timeout":
      return "ChatGPT sign-in timed out. Start again.";
    case "state_mismatch":
      return "ChatGPT sign-in could not be verified. Start again.";
    case "plan_disabled":
      return "You signed in but did not allow ChatGPT plan usage.";
    case "missing_code":
    case "registration_incomplete":
    case "client_mismatch":
    case "invalid_token_response":
    case "invalid_id_token":
    case "subject_mismatch":
      return "ChatGPT sign-in could not be completed. Start again.";
    case "temporarily_unavailable":
      return "ChatGPT is temporarily unavailable. Try again shortly.";
    case "reconnect":
      return "ChatGPT no longer accepts this machine's session.";
    case "client_invalid":
      return "This machine's ChatGPT registration is no longer valid.";
    case "cancelled":
      return "ChatGPT sign-in was cancelled.";
  }
}

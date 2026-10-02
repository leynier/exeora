import type { ChatgptLoginMode, ChatgptStatus } from "../../api-ai.js";
import type { LocalMachine } from "../../api-projects.js";
import { Badge, Row } from "../ui.js";
import {
  CHATGPT_USAGE_URL,
  chatgptAccountLabel,
  chatgptLoginModeForStatus,
  chatgptMachineAvailability,
  chatgptStateCopy,
} from "./chatgpt-state.js";

export type ChatgptMachineRowData = {
  machine: LocalMachine;
  query: { data?: ChatgptStatus; error?: unknown };
};

export function ChatgptRow({
  rows,
  warningDeviceId,
  logoutPending,
  onLogin,
  onLogout,
  onUseApiKey,
}: {
  rows: readonly ChatgptMachineRowData[];
  warningDeviceId: string | null;
  logoutPending: boolean;
  onLogin: (deviceId: string, machineName: string, mode: ChatgptLoginMode) => void;
  onLogout: (deviceId: string) => void;
  onUseApiKey?: () => void;
}) {
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-title-md">ChatGPT plan</p>
          <Badge tone="brand">machine-bound</Badge>
        </div>
        {rows.length === 0 ? (
          <p className="text-body-md text-foreground-faint mt-1">
            Connect a machine with the Exeora CLI to use your ChatGPT plan.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {rows.map(({ machine, query }) => (
              <ChatgptMachineRow
                key={machine.deviceId}
                machine={machine}
                status={query.data}
                error={query.error}
                warning={warningDeviceId === machine.deviceId}
                logoutPending={logoutPending}
                onLogin={onLogin}
                onLogout={onLogout}
                onUseApiKey={onUseApiKey}
              />
            ))}
          </div>
        )}
      </div>
    </Row>
  );
}

function ChatgptMachineRow({
  machine,
  status,
  error,
  warning,
  logoutPending,
  onLogin,
  onLogout,
  onUseApiKey,
}: {
  machine: LocalMachine;
  status: ChatgptStatus | undefined;
  error: unknown;
  warning: boolean;
  logoutPending: boolean;
  onLogin: (deviceId: string, machineName: string, mode: ChatgptLoginMode) => void;
  onLogout: (deviceId: string) => void;
  onUseApiKey?: () => void;
}) {
  const availability = error ? chatgptMachineAvailability(error) : null;
  const state = machine.online && availability === null ? status?.state : undefined;
  return (
    <div className="border-border-subtle rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-title-md">{machine.name}</p>
            {state === "ready" ? <Badge tone="success">ChatGPT plan</Badge> : null}
            {state === "plan_disabled" ? <Badge tone="error">Plan usage off</Badge> : null}
            {state === "reconnect" || state === "client_invalid" ? (
              <Badge tone="error">Sign in again</Badge>
            ) : null}
          </div>
          <p className="text-body-md text-foreground-faint mt-1">
            {availability === "update"
              ? `Update the Exeora CLI on ${machine.name} to sign in with ChatGPT.`
              : availability === "offline" || !machine.online
                ? "Connect a machine with the Exeora CLI to use your ChatGPT plan."
                : availability === "unavailable"
                  ? "Not available on Exeora Cloud machines."
                  : availability === "status_error"
                    ? "ChatGPT status is temporarily unavailable."
                    : state
                      ? chatgptStateCopy(state, machine.name)
                      : "Checking ChatGPT status…"}
          </p>
          {state === "ready" ? (
            <p className="text-body-md text-foreground-faint mt-1">
              {chatgptAccountLabel(status?.account) ?? "ChatGPT account"} · Plan usage allowed
            </p>
          ) : null}
          {warning ? (
            <p className="text-body-md text-error mt-2">
              OpenAI did not confirm revocation. You can disconnect Exeora in{" "}
              <a
                href={CHATGPT_USAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                ChatGPT settings
              </a>
              .
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {availability === "update" ? (
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText("exeora upgrade")}
            >
              Copy exeora upgrade
            </button>
          ) : state === "ready" ? (
            <>
              <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="btn">
                Manage usage
              </a>
              <button
                type="button"
                className="btn btn-danger"
                disabled={logoutPending}
                onClick={() => onLogout(machine.deviceId)}
              >
                {logoutPending ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : state === "plan_disabled" ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onLogin(machine.deviceId, machine.name, "enable_plan")}
              >
                Enable ChatGPT plan usage
              </button>
              {onUseApiKey ? (
                <button type="button" className="btn" onClick={onUseApiKey}>
                  Use an OpenAI API key
                </button>
              ) : null}
            </>
          ) : state === "reconnect" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onLogin(machine.deviceId, machine.name, "reauth")}
            >
              Continue with ChatGPT
            </button>
          ) : state === "client_invalid" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onLogin(machine.deviceId, machine.name, "new")}
            >
              Continue with ChatGPT
            </button>
          ) : availability === "status_error" ||
            availability === "offline" ||
            availability === "unavailable" ||
            !machine.online ||
            state === undefined ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onLogin(machine.deviceId, machine.name, chatgptLoginModeForStatus(status))
              }
            >
              Continue with ChatGPT
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

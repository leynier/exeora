import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText } from "../../api.js";
import {
  aiApi,
  aiKeys,
  type ChatgptLoginError,
  type ChatgptLoginMode,
  type ChatgptStatus,
} from "../../api-ai.js";
import { CopyButton } from "../CopyButton.js";
import { Dialog, DialogActions, DialogError, DialogProgress } from "../Dialog.js";
import { chatgptAuthorizeUrl, chatgptLoginErrorCopy, chatgptStateCopy } from "./chatgpt-state.js";

const POLL_MS = 2_000;

/**
 * Starts the CLI's loopback Sign in with ChatGPT flow and watches only its
 * public state. The authorization URL is opened by an explicit anchor click;
 * the dashboard never receives a token or an id_token_hint.
 */
export function ChatgptLoginDialog({
  deviceId,
  machineName,
  mode,
  open,
  onComplete,
  onCancel,
}: {
  deviceId: string | null;
  machineName: string;
  mode: ChatgptLoginMode;
  open: boolean;
  onComplete: (status: ChatgptStatus) => void;
  onCancel: () => void;
}) {
  const cancelAttempt = useRef<(() => void) | null>(null);
  const cancelFromEscape = () => {
    if (cancelAttempt.current) cancelAttempt.current();
    else onCancel();
  };
  return (
    <Dialog
      open={open && deviceId !== null}
      title="Continue with ChatGPT"
      description={`Open this on ${machineName}.`}
      onCancel={cancelFromEscape}
    >
      {deviceId ? (
        <Login
          deviceId={deviceId}
          machineName={machineName}
          mode={mode}
          onComplete={onComplete}
          onCancel={onCancel}
          cancelAttempt={cancelAttempt}
        />
      ) : null}
    </Dialog>
  );
}

function Login({
  deviceId,
  machineName,
  mode,
  onComplete,
  onCancel,
  cancelAttempt,
}: {
  deviceId: string;
  machineName: string;
  mode: ChatgptLoginMode;
  onComplete: (status: ChatgptStatus) => void;
  onCancel: () => void;
  cancelAttempt: { current: (() => void) | null };
}) {
  const client = useQueryClient();
  const [activeMode, setActiveMode] = useState<ChatgptLoginMode>(mode);
  const [login, setLogin] = useState<{ authorizeUrl: string; expiresAt: number } | null>(null);
  const [outcome, setOutcome] = useState<
    "pending" | "expired" | "plan_disabled" | "reconnect" | "client_invalid" | "login_error"
  >("pending");
  const [loginError, setLoginError] = useState<ChatgptLoginError | null>(null);
  const [pollError, setPollError] = useState<unknown>(null);
  const timer = useRef<number | null>(null);
  const startup = useRef<ReturnType<typeof aiApi.chatgptLogin> | null>(null);
  const cancelRequested = useRef(false);

  const start = useMutation({
    mutationFn: (requestedMode: ChatgptLoginMode) => {
      if (cancelRequested.current) return Promise.reject(new Error("ChatGPT sign-in cancelled."));
      const request = aiApi.chatgptLogin(deviceId, requestedMode);
      startup.current = request;
      return request;
    },
    onSuccess: (value) => {
      if (cancelRequested.current) return;
      setLogin(value);
      setOutcome("pending");
      setLoginError(null);
      setPollError(null);
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await startup.current?.catch(() => undefined);
      return aiApi.chatgptCancel(deviceId);
    },
    onSuccess: () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      onCancel();
    },
  });

  useLayoutEffect(() => {
    cancelAttempt.current = () => {
      if (cancel.isPending) return;
      cancelRequested.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      cancel.mutate();
    };
    return () => {
      cancelAttempt.current = null;
    };
  }, [cancel.isPending, cancel.mutate, cancelAttempt]);

  // The dialog body is mounted afresh whenever it opens, so this starts one
  // attempt per opening and cannot accidentally reuse a previous authorize URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a dialog opening starts one attempt
  useEffect(() => {
    if (cancelRequested.current) return;
    setActiveMode(mode);
    setLogin(null);
    setOutcome("pending");
    setLoginError(null);
    setPollError(null);
    start.mutate(mode);
  }, [deviceId, mode]);

  useEffect(() => {
    if (!login || outcome !== "pending" || cancelRequested.current) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (Date.now() >= login.expiresAt) {
        setOutcome("expired");
        return;
      }
      try {
        const status = await aiApi.chatgptStatus(deviceId);
        if (stopped || cancelRequested.current) return;
        if (status.loginError === "client_invalid") {
          setLoginError(status.loginError);
          setOutcome("client_invalid");
          setPollError(null);
          return;
        }
        if (status.loginError) {
          setLoginError(status.loginError);
          setOutcome("login_error");
          setPollError(null);
          return;
        }
        if (status.state === "ready") {
          await client.invalidateQueries({ queryKey: aiKeys.chatgptStatus(deviceId) });
          if (!stopped && !cancelRequested.current) onComplete(status);
          return;
        }
        if (
          status.state === "plan_disabled" ||
          status.state === "reconnect" ||
          status.state === "client_invalid"
        ) {
          setOutcome(status.state);
          return;
        }
      } catch (error) {
        if (stopped) return;
        setPollError(error);
      }
      timer.current = window.setTimeout(poll, POLL_MS);
    };
    timer.current = window.setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [client, deviceId, login, onComplete, outcome]);

  const safeUrl = chatgptAuthorizeUrl(login?.authorizeUrl);
  const retry = (nextMode = activeMode) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setActiveMode(nextMode);
    setLogin(null);
    setOutcome("pending");
    setLoginError(null);
    setPollError(null);
    start.mutate(nextMode);
  };
  const close = () => {
    cancelAttempt.current?.();
  };

  return (
    <div>
      <p className="text-body-md text-foreground-muted mt-4">
        On another computer, run <code className="font-mono">exeora chatgpt login</code> there.
      </p>
      {login && !cancelRequested.current ? (
        <div className="border-border bg-bg mt-4 rounded-lg border p-4 text-center">
          <p className="text-body-md text-foreground-muted">
            Sign in with ChatGPT on <strong>{machineName}</strong>.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {safeUrl ? (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Open ChatGPT sign-in
              </a>
            ) : (
              <p role="alert" className="text-body-md text-error">
                The gateway returned an invalid ChatGPT sign-in URL.
              </p>
            )}
            <CopyButton value="exeora chatgpt login" label="Copy terminal command" />
          </div>
        </div>
      ) : null}
      <DialogError>
        {cancel.isError
          ? errorText(cancel.error, "ChatGPT sign-in could not be cancelled. Try again.")
          : start.isError
            ? errorText(start.error, "ChatGPT sign-in could not start.")
            : pollError
              ? errorText(pollError, "ChatGPT sign-in could not be checked.")
              : outcome === "expired"
                ? "This sign-in attempt expired. Start again."
                : outcome === "login_error" && loginError
                  ? chatgptLoginErrorCopy(loginError)
                  : outcome === "plan_disabled"
                    ? "You signed in but did not allow ChatGPT plan usage."
                    : outcome === "reconnect"
                      ? chatgptStateCopy("reconnect", machineName)
                      : outcome === "client_invalid"
                        ? chatgptStateCopy("client_invalid", machineName)
                        : null}
      </DialogError>
      <DialogProgress>
        {cancel.isPending
          ? "Cancelling ChatGPT sign-in…"
          : cancelRequested.current
            ? null
            : start.isPending
              ? "Starting ChatGPT sign-in…"
              : outcome === "pending" && login
                ? "Waiting for ChatGPT sign-in…"
                : null}
      </DialogProgress>
      <DialogActions>
        <button type="button" className="btn" disabled={cancel.isPending} onClick={close}>
          Cancel
        </button>
        {outcome === "plan_disabled" ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={start.isPending || cancelRequested.current}
            onClick={() => retry("enable_plan")}
          >
            Enable ChatGPT plan usage
          </button>
        ) : outcome === "reconnect" || outcome === "client_invalid" ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={start.isPending || cancelRequested.current}
            onClick={() => retry(outcome === "reconnect" ? "reauth" : "new")}
          >
            Try again
          </button>
        ) : outcome !== "pending" || start.isError ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={start.isPending || cancelRequested.current}
            onClick={() => retry()}
          >
            Try again
          </button>
        ) : null}
      </DialogActions>
    </div>
  );
}

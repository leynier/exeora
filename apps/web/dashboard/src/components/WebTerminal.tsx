import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";

export function WebTerminal({
  projectId,
  workspace,
  targetLabel,
  available,
  active,
  autoConnect = false,
  kill = false,
  onExit,
}: {
  projectId: string;
  workspace?: string;
  targetLabel: string;
  available: boolean;
  active: boolean;
  autoConnect?: boolean;
  kill?: boolean;
  onExit?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sessionId = useRef<string | null>(null);
  const attempt = useRef(0);
  const size = useRef({ cols: 0, rows: 0 });
  const [confirming, setConfirming] = useState(false);
  const [connecting, setConnecting] = useState(autoConnect);
  const [connected, setConnected] = useState(false);
  const toast = useToast();
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const closeTerminal = useCallback((destroy = false) => {
    attempt.current += 1;
    const openSocket = socket.current;
    if (destroy && openSocket?.readyState === WebSocket.OPEN && sessionId.current) {
      openSocket.send(JSON.stringify({ type: "terminal.close", sessionId: sessionId.current }));
    }
    openSocket?.close(1000, destroy ? "terminal closed" : "terminal detached");
    socket.current = null;
    sessionId.current = null;
    terminal.current?.dispose();
    terminal.current = null;
    fit.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  useEffect(() => () => closeTerminal(false), [closeTerminal]);

  useEffect(() => {
    if (!kill) return;
    closeTerminal(true);
    onExitRef.current?.();
  }, [kill, closeTerminal]);

  const openTerminal = async () => {
    setConfirming(false);
    closeTerminal();
    const opening = ++attempt.current;
    setConnecting(true);
    let openingTerminal: Terminal | null = null;
    try {
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.28,
        scrollback: 5_000,
        theme: {
          background: "#0b0d10",
          foreground: "#e5e7eb",
          cursor: "#8b9cff",
          selectionBackground: "#35415c",
          black: "#17191d",
          brightBlack: "#6b7280",
          red: "#ef6a6a",
          green: "#65c18c",
          yellow: "#e5b567",
          blue: "#6ea8fe",
          magenta: "#c792ea",
          cyan: "#67d4d0",
          white: "#e5e7eb",
        },
      });
      openingTerminal = term;
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      if (!host.current) throw new Error("Terminal surface is unavailable.");
      term.open(host.current);
      fitAddon.fit();
      size.current = { cols: term.cols, rows: term.rows };
      terminal.current = term;
      fit.current = fitAddon;

      const ticket = await api.terminalTicket(projectId, workspace);
      if (attempt.current !== opening) return;
      const target = new URL(ticket.url);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      target.searchParams.set("cols", String(term.cols));
      target.searchParams.set("rows", String(term.rows));
      const ws = new WebSocket(target);
      socket.current = ws;

      ws.addEventListener("message", (event) => {
        if (attempt.current !== opening) return;
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "terminal.opened" && typeof message.sessionId === "string") {
          sessionId.current = message.sessionId;
          setConnected(true);
          setConnecting(false);
          term.focus();
        } else if (message.type === "terminal.output" && typeof message.data === "string") {
          term.write(base64Bytes(message.data));
        } else if (message.type === "terminal.exit") {
          term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
          setConnected(false);
          onExitRef.current?.();
        } else if (message.type === "terminal.error" && typeof message.message === "string") {
          term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
          toast(message.message, "error");
          setConnecting(false);
          onExitRef.current?.();
        }
      });
      ws.addEventListener("close", () => {
        if (attempt.current !== opening) return;
        setConnected(false);
        setConnecting(false);
      });
      ws.addEventListener("error", () => {
        if (attempt.current !== opening) return;
        toast("The terminal connection failed.", "error");
        setConnecting(false);
      });
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN && sessionId.current) {
          ws.send(
            JSON.stringify({
              type: "terminal.input",
              sessionId: sessionId.current,
              data: bytesBase64(new TextEncoder().encode(data)),
            }),
          );
        }
      });
      const observer = new ResizeObserver(() => {
        if (attempt.current !== opening) return;
        fitAddon.fit();
        if (term.cols === size.current.cols && term.rows === size.current.rows) return;
        size.current = { cols: term.cols, rows: term.rows };
        if (ws.readyState === WebSocket.OPEN && sessionId.current) {
          ws.send(
            JSON.stringify({
              type: "terminal.resize",
              sessionId: sessionId.current,
              cols: term.cols,
              rows: term.rows,
            }),
          );
        }
      });
      observer.observe(host.current);
      ws.addEventListener("close", () => observer.disconnect(), { once: true });
    } catch (error) {
      openingTerminal?.dispose();
      if (attempt.current === opening) {
        closeTerminal();
        toast(error instanceof Error ? error.message : "Could not open the terminal.", "error");
        onExitRef.current?.();
      }
    }
  };

  // Connect once when this session is mounted; reopen is a new session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only connect
  useEffect(() => {
    if (!autoConnect) return;
    void openTerminal();
  }, [autoConnect]);

  useEffect(() => {
    if (!active) return;
    const addon = fit.current;
    const term = terminal.current;
    if (!addon || !term) return;
    addon.fit();
    if (term.cols === size.current.cols && term.rows === size.current.rows) return;
    size.current = { cols: term.cols, rows: term.rows };
    if (socket.current?.readyState === WebSocket.OPEN && sessionId.current) {
      socket.current.send(
        JSON.stringify({
          type: "terminal.resize",
          sessionId: sessionId.current,
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  }, [active]);

  const idle = !autoConnect && !connected && !connecting;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0d10]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
          <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-gray-600"}`} />
          {connected ? "live shell" : connecting ? "connecting" : "terminal stopped"}
        </div>
        {connected || connecting ? (
          <button
            type="button"
            className="btn border-white/15 text-gray-300"
            onClick={() => {
              closeTerminal(true);
              onExit?.();
            }}
          >
            Close terminal
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!available}
            onClick={() => setConfirming(true)}
          >
            Open terminal
          </button>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <div className="web-terminal-surface absolute inset-0" ref={host} />
        {idle && (
          <div className="absolute inset-0 grid place-items-center text-center font-mono text-sm text-gray-500">
            <p>
              {available
                ? `Start an interactive shell in ${targetLabel}.`
                : "Connect or update the Exeora CLI to enable the terminal."}
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Open a remote shell?"
        body={`Commands run directly on your connected machine in ${targetLabel}. Exeora does not record keystrokes, commands, or terminal output.`}
        confirmLabel="Open terminal"
        onConfirm={openTerminal}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

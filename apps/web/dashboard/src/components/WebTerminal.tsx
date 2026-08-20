import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useToast } from "./toast.js";

export function WebTerminal({
  projectId,
  worktree,
  targetLabel,
  available,
}: {
  projectId: string;
  worktree?: string;
  targetLabel: string;
  available: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sessionId = useRef<string | null>(null);
  const attempt = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const toast = useToast();

  const closeTerminal = useCallback(() => {
    attempt.current += 1;
    const openSocket = socket.current;
    if (openSocket?.readyState === WebSocket.OPEN && sessionId.current) {
      openSocket.send(JSON.stringify({ type: "terminal.close", sessionId: sessionId.current }));
    }
    openSocket?.close(1000, "terminal closed");
    socket.current = null;
    sessionId.current = null;
    terminal.current?.dispose();
    terminal.current = null;
    fit.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  useEffect(() => () => closeTerminal(), [closeTerminal]);

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
      terminal.current = term;
      fit.current = fitAddon;

      const ticket = await api.terminalTicket(projectId, worktree);
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
        } else if (message.type === "terminal.error" && typeof message.message === "string") {
          term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
          toast(message.message, "error");
          setConnecting(false);
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
      }
    }
  };

  return (
    <section className="border-border overflow-hidden rounded-xl border bg-[#0b0d10]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
          <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-gray-600"}`} />
          {connected ? "live shell" : connecting ? "connecting" : "terminal stopped"}
        </div>
        {connected || connecting ? (
          <button
            type="button"
            className="btn border-white/15 text-gray-300"
            onClick={closeTerminal}
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
      <div className="min-h-[28rem] p-3" ref={host}>
        {!connected && !connecting && !terminal.current && (
          <div className="grid min-h-[26rem] place-items-center text-center font-mono text-sm text-gray-500">
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

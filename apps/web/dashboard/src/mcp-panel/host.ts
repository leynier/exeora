import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { ContextHost } from "./comments/contextWriter.js";
import type { CallTool, ToolAnswer } from "./transport.js";

/**
 * The panel's side of MCP Apps: one `App` talking to ChatGPT over
 * `postMessage`, and what the host has said so far kept where React can read
 * it. The handlers are in place before `connect`, since the host may send the
 * entrypoint's arguments and result as soon as the handshake completes.
 */

export type DisplayMode = "inline" | "fullscreen" | "pip";

export interface HostContext {
  displayMode?: DisplayMode;
  availableDisplayModes?: DisplayMode[];
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
  "openai/deepLink"?: unknown;
  [key: string]: unknown;
}

export interface HostState {
  connection: "connecting" | "connected" | "failed";
  error: string | null;
  context: HostContext;
  /** Arguments of the tool that opened the panel; set once the host sends them. */
  input: Record<string, unknown> | null;
  result: ToolAnswer | null;
  cancelled: boolean;
  /**
   * Whether the host hands files over as resources it amends tool calls for
   * (`openai/resource`). ChatGPT does on desktop only.
   */
  fileAccess: boolean;
}

export interface Host {
  state: () => HostState;
  subscribe: (listener: () => void) => () => void;
  call: CallTool;
  openLink: (url: string) => Promise<boolean>;
  requestDisplayMode: (mode: DisplayMode) => Promise<DisplayMode | null>;
  /** This app's model context, written strictly: a failure is a failure. */
  modelContext: ContextHost;
  /**
   * What the host says this app has in model context
   * (`hostContext["openai/modelContext"]`): once connected, and on each change.
   * `null` means it was removed.
   */
  onModelContext: (listener: (context: unknown) => void) => () => void;
}

/** Tools the app itself answers, for the host and its model. */
const MODEL_CONTEXT = "openai/modelContext";

export interface AppToolHandlers {
  list: () => { name: string; [key: string]: unknown }[];
  call: (name: string, args: Record<string, unknown> | undefined) => Promise<ToolAnswer>;
}

export function connectHost(options: { name?: string; tools?: AppToolHandlers } = {}): Host {
  const app = new App(
    { name: options.name ?? "Exeora Workspace", version: "1.0.0" },
    {
      availableDisplayModes: ["inline", "fullscreen"],
      ...(options.tools ? { tools: { listChanged: false } } : {}),
    },
  );
  // Before connecting, like every handler: the host may ask at once.
  if (options.tools) {
    const tools = options.tools;
    app.onlisttools = async () => ({ tools: tools.list() as never });
    app.oncalltool = async (params) => (await tools.call(params.name, params.arguments)) as never;
  }
  let state: HostState = {
    connection: "connecting",
    error: null,
    context: {},
    input: null,
    result: null,
    cancelled: false,
    fileAccess: false,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<HostState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  // A panel kept open in a thread hears of every later call: new arguments
  // start over, and the result that follows is theirs.
  app.ontoolinput = (params) =>
    update({ input: params.arguments ?? {}, result: null, cancelled: false });
  app.ontoolresult = (params) => update({ result: params as ToolAnswer });
  app.ontoolcancelled = () => update({ cancelled: true });
  // A change carries only what changed, the deep link among it.
  const contextListeners = new Set<(context: unknown) => void>();
  const tellModelContext = (context: unknown) => {
    for (const listener of contextListeners) listener(context);
  };
  app.onhostcontextchanged = (params) => {
    update({ context: { ...state.context, ...(params as HostContext) } });
    if (MODEL_CONTEXT in params)
      tellModelContext((params as Record<string, unknown>)[MODEL_CONTEXT]);
  };
  app.onteardown = async () => ({});

  app.connect(new PostMessageTransport(window.parent, window.parent)).then(
    () => {
      const initial = (app.getHostContext() as HostContext | undefined) ?? {};
      update({
        connection: "connected",
        context: { ...initial, ...state.context },
        fileAccess: app.getHostCapabilities()?.experimental?.["openai/resource"] !== undefined,
      });
      if (MODEL_CONTEXT in initial) tellModelContext(initial[MODEL_CONTEXT]);
    },
    (error: unknown) =>
      update({
        connection: "failed",
        error: error instanceof Error ? error.message : "The host did not answer.",
      }),
  );

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: async (name, args, signal) =>
      (await app.callServerTool(
        { name, arguments: args },
        signal ? { signal } : undefined,
      )) as ToolAnswer,
    openLink: async (url) => {
      try {
        const result = await app.openLink({ url });
        return result.isError !== true;
      } catch {
        return false;
      }
    },
    modelContext: {
      connected: () => state.connection === "connected",
      supportsText: () => app.getHostCapabilities()?.updateModelContext?.text !== undefined,
      update: async (params) => {
        if (state.connection !== "connected") {
          throw new Error("ChatGPT is not connected to this panel.");
        }
        const result = await app.updateModelContext(params as never);
        const meta = result?._meta?.[MODEL_CONTEXT] as { updateId?: unknown } | undefined;
        return typeof meta?.updateId === "string" ? meta.updateId : null;
      },
    },
    onModelContext: (listener) => {
      contextListeners.add(listener);
      return () => {
        contextListeners.delete(listener);
      };
    },
    requestDisplayMode: async (mode) => {
      try {
        const { mode: granted } = await app.requestDisplayMode({ mode });
        update({ context: { ...state.context, displayMode: granted as DisplayMode } });
        return granted as DisplayMode;
      } catch {
        return null;
      }
    },
  };
}

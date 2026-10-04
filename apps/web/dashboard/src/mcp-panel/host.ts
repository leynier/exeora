import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-with-deps";
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
  /** Tells the model what the app shows; structured, never contents. */
  updateModelContext: (structured: Record<string, unknown>) => Promise<void>;
}

/** Tools the app itself answers, for the host and its model. */
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
  app.onhostcontextchanged = (params) =>
    update({ context: { ...state.context, ...(params as HostContext) } });
  app.onteardown = async () => ({});

  app.connect(new PostMessageTransport(window.parent, window.parent)).then(
    () =>
      update({
        connection: "connected",
        context: { ...((app.getHostContext() as HostContext | undefined) ?? {}), ...state.context },
        fileAccess: app.getHostCapabilities()?.experimental?.["openai/resource"] !== undefined,
      }),
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
    updateModelContext: async (structured) => {
      if (state.connection !== "connected") return;
      try {
        await app.updateModelContext({ structuredContent: structured });
      } catch {
        // A host that does not take context still has the tools to ask.
      }
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

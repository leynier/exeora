import {
  EMPTY_SEARCH,
  type SearchState,
  sameSearch,
  searchStore,
} from "../components/search/searchStore.js";
import { bufferStore } from "../components/workspace/bufferStore.js";
import type { WorkspaceSnapshot, WorkspaceTarget } from "../components/workspace/surface.js";
import type { WorkspaceView } from "../components/workspace/workspaceLayout.js";
import { canonicalSelector } from "../selectors.js";
import { type PanelSelection, readAnswer, selectionRoute } from "./selection.js";
import { answerText, type CallTool } from "./transport.js";

/**
 * Where the panel goes, whoever asks: a later call ChatGPT hands over, a deep
 * link, the model through `exeora_workspace_navigate` (over the relay, or as
 * this panel's own tool), or the person picking another project or working
 * copy in the Workspace itself.
 *
 * Every request becomes a route the panel's router follows. One that leaves
 * the working copy while edits there are unsaved waits for the person to
 * confirm it (the latest such request is the one asked about). A navigation
 * the model asked for is checked by the gateway first, against the
 * connection's grants as they are now. Any newer request, from any of
 * those sources, overtakes one still being checked, which is then dropped
 * rather than applied late. While a question is open, nothing else moves the
 * panel: the person answers first.
 *
 * A navigation reports `applied` once the Workspace shows it, as it says in
 * its own report; one the Workspace has not shown in time is `queued`. One
 * given a deadline or a signal is never applied after either: an answer
 * from the gateway that comes too late is dropped, and the navigation is
 * `cancelled`.
 */

/** The gateway's private check of where a navigation goes; it opens nothing. */
export const RESOLVE_NAVIGATION_TOOL = "exeora_panel_resolve_navigation";

/** Kept back from a deadline, so the answer still has time to travel. */
const DEADLINE_MARGIN_MS = 500;

export interface NavigateOptions {
  /** Aborted when whoever asked stops waiting: nothing is applied after. */
  signal?: AbortSignal;
  /** Epoch milliseconds after which the navigation is no longer wanted. */
  deadline?: number;
}

export type NavigateStatus =
  | "applied"
  | "queued"
  | "needs_confirmation"
  | "cancelled"
  | "error"
  | "superseded";

/** What `exeora_workspace_navigate` takes; anything left out stays as it is. */
export interface NavigateArgs {
  project?: string;
  workspace?: string;
  tab?: WorkspaceView;
  path?: string;
  diff?: { path: string; area?: "working" | "staged" };
  search?: Partial<SearchState>;
}

export interface PendingConfirmation {
  projectId: string | null;
  workspace: string | null;
  dirtyPaths: string[];
}

/** What the panel shows, for the model: places and names only, never contents. */
export interface PanelState {
  projectId: string | null;
  workspace: string | null;
  tab: WorkspaceView | null;
  /** The file or diff in front, if any. */
  path: string | null;
  diff: { path: string; area: "working" | "staged" } | null;
  openPaths: string[];
  dirtyPaths: string[];
  search: SearchState | null;
  pendingConfirmation: PendingConfirmation | null;
  /** How the last question about unsaved edits was answered. */
  lastConfirmation: "applied" | "cancelled" | null;
}

export interface NavigateResult {
  status: NavigateStatus;
  message?: string;
  state: PanelState;
}

interface Pending {
  to: WorkspaceTarget;
  dirtyPaths: string[];
  proceed: () => void;
  /** Asked by the model, which a Stop takes back. */
  byModel?: boolean;
}

export class PanelController {
  private snapshot: WorkspaceSnapshot | null = null;
  private pending: Pending | null = null;
  private target: { route: string | null; version: number } = { route: null, version: 0 };
  /** Bumped by every request that moves the panel, whoever made it. */
  private epoch = 0;
  private listeners = new Set<() => void>();
  private stopSearch: (() => void) | null = null;
  private cached: PanelState | null = null;
  private answered: "applied" | "cancelled" | null = null;

  private waiters = new Set<() => void>();

  constructor(
    private readonly call: CallTool,
    private readonly settleMs = 5_000,
    /** The gateway's address for this panel, once known: it checks the panel is the caller's. */
    private readonly panelId: () => string | null = () => null,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The route the panel should be on; a new `version` is a new request. */
  route = (): { route: string | null; version: number } => this.target;

  pendingConfirmation = (): PendingConfirmation | null => this.state().pendingConfirmation;

  /** From the Workspace, as what it shows changes. */
  report = (snapshot: WorkspaceSnapshot): void => {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    if (previous?.projectId !== snapshot.projectId || previous?.targetKey !== snapshot.targetKey) {
      this.stopSearch?.();
      this.stopSearch = snapshot.projectId
        ? searchStore.subscribe(snapshot.projectId, snapshot.targetKey, this.changed)
        : null;
    }
    this.changed();
  };

  /** From the Workspace's own selectors, and from every request below. */
  changeTarget = (to: WorkspaceTarget, proceed: () => void): "applied" | "needs_confirmation" => {
    // An open question is answered before anything else moves the panel.
    if (this.pending) return "needs_confirmation";
    this.epoch++;
    const current = this.snapshot;
    const dirtyPaths = current?.projectId
      ? bufferStore.dirtyPaths(current.projectId, current.targetKey)
      : [];
    const leaving = current !== null && !sameTarget(current, to.projectId, to.workspace);
    if (!leaving || dirtyPaths.length === 0) {
      proceed();
      this.emit();
      return "applied";
    }
    this.pending = { to, dirtyPaths, proceed };
    this.emit();
    return "needs_confirmation";
  };

  /** Goes to a Workspace route, asking first if it leaves unsaved edits. */
  request(route: string): "applied" | "needs_confirmation" {
    const params = new URL(route, "https://panel.invalid").searchParams;
    return this.changeTarget(
      { projectId: params.get("project"), workspace: params.get("workspace") },
      () => {
        this.target = { route, version: this.target.version + 1 };
      },
    );
  }

  confirm = (): void => {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.answered = "applied";
    pending.proceed();
    this.emit();
  };

  cancel = (): void => {
    if (!this.pending) return;
    this.pending = null;
    this.answered = "cancelled";
    this.emit();
  };

  /**
   * The person stopped the model, or the session it acted for ended: no
   * answer still on its way from the gateway is applied, and a question
   * about unsaved edits the model raised is taken back.
   */
  stopModel = (): void => {
    this.epoch++;
    if (this.pending?.byModel) this.cancel();
    this.changed();
  };

  /**
   * The person took the Dashboard to a screen without the Workspace, or
   * from one such screen to another: nothing is described as on screen until
   * the Workspace reports again, and no move the model asked for that is
   * still being checked lands over where the person went. A question the
   * model raised goes with it; one the person raised stays theirs to answer.
   */
  forget = (): void => {
    this.snapshot = null;
    this.stopSearch?.();
    this.stopSearch = null;
    this.stopModel();
  };

  async navigate(args: NavigateArgs, options: NavigateOptions = {}): Promise<NavigateResult> {
    if (this.pending) return this.result("needs_confirmation", "The person has not answered yet.");
    const late = lateness(options);
    if (late.expired()) {
      late.done();
      return this.result("cancelled", late.reason());
    }
    const epoch = ++this.epoch;
    const request = this.requestFor(args);

    let answer: Awaited<ReturnType<CallTool>>;
    try {
      answer = await this.call(RESOLVE_NAVIGATION_TOOL, request, late.signal);
    } catch (error) {
      if (late.expired()) return this.result("cancelled", late.reason());
      if (epoch !== this.epoch) return this.result("superseded");
      return this.result(
        "error",
        error instanceof Error ? error.message : "Exeora did not answer.",
      );
    } finally {
      late.done();
    }
    // Too late is never applied, whatever the gateway said.
    if (late.expired()) return this.result("cancelled", late.reason());
    if (epoch !== this.epoch) return this.result("superseded");
    if (answer.isError) return this.result("error", answerText(answer) || "Not a place to go.");
    const read = readAnswer(answer.structuredContent);
    if (read?.kind !== "selection") return this.result("error", "Exeora did not name a place.");
    const selection = read.selection;
    if (this.request(selectionRoute(selection)) === "needs_confirmation") {
      // Narrowed to null above, before the await: the question is new.
      const asked = this.pending as Pending | null;
      if (asked) asked.byModel = true;
      return this.result("needs_confirmation");
    }
    const wait = options.deadline
      ? Math.min(this.settleMs, Math.max(0, options.deadline - Date.now() - DEADLINE_MARGIN_MS))
      : this.settleMs;
    return this.result(
      await this.settled(
        this.epoch,
        (snapshot) => shows(snapshot, selection),
        wait,
        options.signal,
      ),
    );
  }

  /** What to ask the gateway: the request, with what it left out as it is now. */
  private requestFor(args: NavigateArgs): Record<string, unknown> {
    const current = this.snapshot;
    const moving =
      (args.project !== undefined && args.project !== current?.projectId) ||
      (args.workspace !== undefined &&
        (!current || !sameTarget(current, current.projectId, args.workspace)));
    const content = args.path ?? args.diff ?? args.search;
    const project = args.project ?? current?.projectId ?? undefined;
    // The root on screen is named, never left for the gateway to fill with
    // the connection's saved default, which may be another working copy.
    const workspace =
      args.workspace ?? (moving || !current?.projectId ? undefined : (current.workspace ?? "main"));
    // A search changes what it names and keeps the rest of the one on screen.
    const search = args.search
      ? {
          ...EMPTY_SEARCH,
          ...(current?.projectId && !moving
            ? searchStore.get(current.projectId, current.targetKey)
            : {}),
          ...args.search,
        }
      : undefined;
    const panelId = this.panelId();
    return {
      ...(panelId ? { panelId } : {}),
      ...(project ? { project } : {}),
      ...(workspace ? { workspace } : {}),
      // Without content to imply one, the view on screen stays.
      ...(args.tab ? { tab: args.tab } : !content && current ? { tab: current.view } : {}),
      ...(args.path ? { path: args.path } : {}),
      ...(args.diff ? { diff: { area: "working", ...args.diff } } : {}),
      ...(search ? { search } : {}),
    };
  }

  /**
   * Waits for the Workspace to say it shows what was asked: `applied`, or
   * `superseded` if something else moved the panel first, or `queued` when
   * it has not in `waitMs`, or once whoever asked stops waiting.
   */
  private settled(
    epoch: number,
    shown: (snapshot: WorkspaceSnapshot) => boolean,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<"applied" | "queued" | "superseded"> {
    return new Promise((resolve) => {
      const finish = (outcome: "applied" | "queued" | "superseded") => {
        clearTimeout(timer);
        this.waiters.delete(check);
        signal?.removeEventListener("abort", stop);
        resolve(outcome);
      };
      const stop = () => finish("queued");
      const check = () => {
        if (epoch !== this.epoch) finish("superseded");
        else if (this.snapshot && shown(this.snapshot)) finish("applied");
      };
      const timer = setTimeout(() => finish("queued"), waitMs);
      signal?.addEventListener("abort", stop, { once: true });
      this.waiters.add(check);
      check();
      if (signal?.aborted) stop();
    });
  }

  state(): PanelState {
    const snapshot = this.snapshot;
    const active = snapshot?.active ?? null;
    const search =
      snapshot?.projectId !== null && snapshot !== null
        ? searchStore.get(snapshot.projectId as string, snapshot.targetKey)
        : null;
    const next: PanelState = {
      projectId: snapshot?.projectId ?? null,
      workspace: snapshot?.workspace ?? null,
      tab: snapshot?.view ?? null,
      path: active && "path" in active ? active.path : null,
      diff: active?.kind === "diff" ? { path: active.path, area: active.area } : null,
      openPaths: snapshot?.openPaths ?? [],
      dirtyPaths: snapshot?.projectId
        ? bufferStore.dirtyPaths(snapshot.projectId, snapshot.targetKey)
        : [],
      search: search && (search.query || snapshot?.view === "search") ? search : null,
      pendingConfirmation: this.pending
        ? {
            projectId: this.pending.to.projectId,
            workspace: this.pending.to.workspace,
            dirtyPaths: this.pending.dirtyPaths,
          }
        : null,
      lastConfirmation: this.answered,
    };
    // The same answer while nothing changed, for React's external stores.
    if (this.cached && JSON.stringify(this.cached) === JSON.stringify(next)) return this.cached;
    this.cached = next;
    return next;
  }

  private result(status: NavigateStatus, message?: string): NavigateResult {
    return { status, ...(message ? { message } : {}), state: this.state() };
  }

  /** What the Workspace shows changed: a navigation waiting on it may be done. */
  private changed = (): void => {
    for (const waiter of this.waiters) waiter();
    this.emit();
  };

  private emit = (): void => {
    for (const listener of this.listeners) listener();
  };
}

/**
 * One signal for a navigation's own `signal` and its `deadline`, whichever
 * comes first, and the sentence for having missed it.
 */
function lateness({ signal, deadline }: NavigateOptions) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer =
    deadline === undefined ? undefined : setTimeout(stop, Math.max(0, deadline - Date.now()));
  const expired = () =>
    controller.signal.aborted || (deadline !== undefined && Date.now() >= deadline);
  return {
    signal: controller.signal,
    expired,
    reason: () =>
      signal?.aborted
        ? "The navigation was stopped before the Workspace moved; it did not move."
        : "The navigation ran out of time before the Workspace moved; it did not move.",
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    },
  };
}

/**
 * Whether a project and selector name the working copy the Workspace shows.
 * The root of the default location answers to `main`, to nothing and to
 * `main@<its slug>`; the root of another location stays its own.
 */
function sameTarget(
  snapshot: WorkspaceSnapshot,
  projectId: string | null | undefined,
  workspace: string | null | undefined,
): boolean {
  if ((snapshot.projectId ?? null) !== (projectId ?? null)) return false;
  const project = snapshot.locations ? { locations: snapshot.locations } : undefined;
  return canonicalSelector(snapshot.workspace, project) === canonicalSelector(workspace, project);
}

/** Whether the Workspace shows what a selection named. */
function shows(snapshot: WorkspaceSnapshot, selection: PanelSelection): boolean {
  if (!sameTarget(snapshot, selection.projectId, selection.workspace)) return false;
  const view =
    selection.tab ??
    (selection.path ? "explorer" : selection.diff ? "source" : selection.search ? "search" : null);
  if (view && snapshot.view !== view) return false;
  const active = snapshot.active;
  if (selection.path && (active?.kind !== "file" || active.path !== selection.path)) return false;
  if (
    selection.diff &&
    (active?.kind !== "diff" ||
      active.path !== selection.diff.path ||
      active.area !== selection.diff.area)
  ) {
    return false;
  }
  if (selection.search && snapshot.projectId) {
    return sameSearch(searchStore.get(snapshot.projectId, snapshot.targetKey), selection.search);
  }
  return true;
}

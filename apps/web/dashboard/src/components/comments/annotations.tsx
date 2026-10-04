import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { CommentComposer, CommentsButton, CommentsReview } from "./CommentsUI.js";
import type { CommentSource, Draft, Selected, SourceInView } from "./model.js";
import { CommentStore } from "./store.js";

/**
 * Comments on what the Workspace shows, wherever it runs: the dashboard, the
 * Chrome side panel, ChatGPT's panel.
 *
 * Every Workspace can comment on a selection, keep the comments waiting, and
 * copy them all. Only an embedding that hands them to a model (ChatGPT's MCP
 * App) gives a `context`; its absence is what keeps "Add to context" off the
 * dashboard and the side panel. Nothing is guessed from the page around it.
 */

/** What an embedding offers for handing comments to a model. */
export interface ContextCapability {
  /** Resolves once the host has taken the batch; rejects with a sentence otherwise. */
  publish: (drafts: readonly Draft[]) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  /** The batches attached now, with what the model reads for each. */
  batches: () => { id: string; title: string; text: string }[];
}

export interface Annotations {
  store: CommentStore;
  context: ContextCapability | null;
}

const AnnotationsContext = createContext<Annotations | null>(null);

/**
 * Where a Workspace's comments live. With no `value`, a store of its own, as
 * long as this provider stays mounted.
 */
export function AnnotationsProvider({
  value,
  children,
}: {
  value?: Annotations;
  children: ReactNode;
}) {
  const [own] = useState<Annotations>(() => value ?? { store: new CommentStore(), context: null });
  return <AnnotationsContext.Provider value={value ?? own}>{children}</AnnotationsContext.Provider>;
}

/** A store for a Workspace that no embedding gave one. */
export function EnsureAnnotations({ children }: { children: ReactNode }) {
  const outer = useContext(AnnotationsContext);
  return outer ? children : <AnnotationsProvider>{children}</AnnotationsProvider>;
}

type Compose = (selected: { source: SourceInView; snippet: string }) => void;

const ComposeContext = createContext<{ compose: Compose; review: () => void } | null>(null);

/** Offers a selection to comment on; null outside a Workspace. */
export function useCommentCompose(): Compose | null {
  return useContext(ComposeContext)?.compose ?? null;
}

/** The header button that opens the comments of this Workspace. */
export function CommentsHeaderButton() {
  const annotations = useContext(AnnotationsContext);
  const scope = useContext(ComposeContext);
  if (!annotations || !scope) return null;
  return <CommentsButton store={annotations.store} onOpen={scope.review} />;
}

/**
 * One Workspace's comment flow: a view offers a selection, the person writes
 * on it, pinned to the project and working copy on screen; the review lists
 * what waits, copies it, and (in ChatGPT) adds it to the conversation.
 */
export function CommentScope({
  projectId,
  workspace,
  children,
}: {
  projectId: string | null;
  workspace: string | null;
  children: ReactNode;
}) {
  const annotations = useContext(AnnotationsContext);
  const [composing, setComposing] = useState<Selected | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const compose = useCallback<Compose>(
    (selected) => {
      if (!projectId) return;
      setComposing({
        snippet: selected.snippet,
        source: { ...selected.source, projectId, workspace } as CommentSource,
      });
    },
    [projectId, workspace],
  );
  const scope = useMemo(() => ({ compose, review: () => setReviewing(true) }), [compose]);

  const publish = useCallback(async () => {
    const context = annotations?.context;
    const store = annotations?.store;
    if (!context || !store) return;
    const batch = store.begin();
    if (!batch) return;
    try {
      await context.publish(batch);
      store.end(batch, null);
    } catch (error) {
      store.end(
        batch,
        error instanceof Error && error.message
          ? error.message
          : "ChatGPT did not take the comments. Try again.",
      );
    }
  }, [annotations]);

  if (!annotations) return children;
  return (
    <ComposeContext.Provider value={scope}>
      {children}
      <CommentComposer
        selected={composing}
        store={annotations.store}
        onClose={() => setComposing(null)}
      />
      <CommentsReview
        open={reviewing}
        store={annotations.store}
        context={annotations.context}
        onPublish={() => void publish()}
        onClose={() => setReviewing(false)}
      />
    </ComposeContext.Provider>
  );
}

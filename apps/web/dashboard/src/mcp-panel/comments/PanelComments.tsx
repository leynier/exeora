import type { Annotations } from "../../components/comments/annotations.js";
import type { CommentStore } from "../../components/comments/store.js";
import type { ContextWriter } from "./contextWriter.js";

/**
 * This panel's comments: kept per conversation instance (and in its private
 * widget state where ChatGPT keeps one), and the one capability the
 * dashboard and the Chrome side panel never get: adding them to the model's
 * context, through the writer that owns that context.
 */
export function panelAnnotations(store: CommentStore, writer: ContextWriter): Annotations {
  return {
    store,
    context: {
      publish: async (drafts) => {
        await writer.publish(drafts);
      },
      subscribe: writer.subscribe,
      batches: writer.batches,
    },
  };
}

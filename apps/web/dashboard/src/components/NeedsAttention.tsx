import { Link } from "react-router";
import type { AttentionItem } from "../attention.js";
import { Card, Divided } from "./ui.js";

/**
 * What is wrong right now, each with the way to where it is put right.
 *
 * Always on the page, including when there is nothing to say: a card that
 * only appears when something broke teaches nobody to look for it, and one
 * that says "nothing" is how a person learns that nothing is wrong.
 */
export function NeedsAttention({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  return (
    <Card title="Needs your attention">
      {loading ? (
        <p className="text-body-md text-foreground-faint px-5 py-4">Checking…</p>
      ) : items.length === 0 ? (
        <p className="text-body-md text-foreground-muted px-5 py-4">
          Nothing needs your attention.
        </p>
      ) : (
        <Divided>
          {items.map((item) => (
            <div
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-title-md">{item.title}</p>
                <p className="text-body-md text-foreground-muted mt-0.5">{item.action}</p>
              </div>
              <Link to={item.to} className="btn shrink-0">
                {item.linkLabel}
              </Link>
            </div>
          ))}
        </Divided>
      )}
    </Card>
  );
}

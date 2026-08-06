import type { ReactNode } from "react";

/**
 * The small pieces every screen is built from. They live together because they
 * are all a few lines each and always change as a set.
 */

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-border bg-surface overflow-hidden rounded-xl border ${className}`}>
      {title && (
        <header className="border-border-subtle flex items-center justify-between gap-4 border-b px-5 py-3.5">
          <h2 className="text-title-md text-foreground">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function Divided({ children }: { children: ReactNode }) {
  return <div className="divide-border-subtle divide-y">{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-headline-md">{title}</h1>
        {subtitle && <p className="text-body-md text-foreground-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-title-md text-foreground">{title}</p>
      {children && <div className="text-body-md text-foreground-muted mt-2">{children}</div>}
    </div>
  );
}

/** A live/idle indicator. Colour alone would not carry it, so it is labelled. */
export function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex size-2 shrink-0 items-center justify-center" title={label}>
      <span className="sr-only">{label}</span>
      {on && (
        <span className="bg-success absolute inline-flex size-2 animate-ping rounded-full opacity-60" />
      )}
      <span
        className={`relative inline-flex size-2 rounded-full ${on ? "bg-success" : "bg-foreground-faint/40"}`}
      />
    </span>
  );
}

export function Skeleton({ className = "h-4 w-32" }: { className?: string }) {
  return <span className={`skeleton block rounded-md ${className}`} />;
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <Divided>
      {Array.from({ length: count }, (_, index) => (
        // No stable id exists for a placeholder, and the list never reorders.
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, not data
        <Row key={index}>
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-7 w-20" />
        </Row>
      ))}
    </Divided>
  );
}

export function Stat({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="border-border bg-surface rounded-xl border p-5">
      <p className="text-label-md text-foreground-faint font-mono uppercase">{label}</p>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-16" />
      ) : (
        <p className="text-headline-md mt-2 tabular-nums">{value}</p>
      )}
      {hint && <p className="text-body-md text-foreground-faint mt-1">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "error" | "brand";
}) {
  const tones = {
    neutral: "bg-accent-subtle text-foreground-muted",
    success: "bg-success/12 text-success",
    error: "bg-error/12 text-error",
    brand: "bg-brand-subtle text-brand",
  };
  return (
    <span className={`text-label-md rounded-pill px-2 py-0.5 font-mono uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

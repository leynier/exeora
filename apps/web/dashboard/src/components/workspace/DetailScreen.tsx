import { IconButton } from "@exeora/design/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A screen pushed over a narrow layout: the diff of a file, the files of a
 * commit. It fills the pane and carries Back, which pops it the way the
 * browser's own Back does, since both edit the same address.
 */
export function DetailScreen({
  title,
  subtitle,
  onBack,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={title}>
      <header className="border-border-subtle flex shrink-0 items-center gap-1.5 border-b py-1.5 pr-2 pl-1">
        <IconButton label="Back" icon={ArrowLeft} onClick={onBack} />
        <div className="min-w-0 flex-1">
          <p className="text-title-md truncate font-mono">{title}</p>
          {subtitle ? (
            <p className="text-label-md text-foreground-faint truncate font-mono uppercase">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

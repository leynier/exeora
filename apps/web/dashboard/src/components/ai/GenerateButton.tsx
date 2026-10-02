import { IconButton, type MenuEntry, MenuPanel, placeAnchored } from "@exeora/design/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, type LucideIcon, Sparkles, Square } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { errorText } from "../../api.js";
import { type AiProviderId, aiApi, aiKeys } from "../../api-ai.js";
import { useToast } from "../toast.js";

/**
 * The assistant's button beside a field: one click asks the linked
 * provider to write what the field is for, and the spinner turns into a
 * stop while it thinks.
 *
 * What comes back lands in the field only if the field is as it was when
 * the request went out; a person who typed meanwhile keeps their words and
 * hears that the generated text was set aside. With more than one provider
 * linked, a menu under the button picks one for this time.
 */
export function GenerateButton({
  label,
  icon = Sparkles,
  generate,
  fieldValue,
  disabled = false,
  reason,
  size = "sm",
}: {
  label: string;
  icon?: LucideIcon;
  /** Runs the generation with the chosen provider; the signal stops it. */
  generate: (provider: AiProviderId | undefined, signal: AbortSignal) => Promise<void>;
  /** What the field holds, read again when the answer arrives. */
  fieldValue: () => string;
  disabled?: boolean;
  /** Why it cannot run now, for the tooltip. */
  reason?: string;
  size?: "sm" | "md";
}) {
  const status = useQuery({ queryKey: aiKeys.status, queryFn: aiApi.status, staleTime: 60_000 });
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const linked = status.data?.providers.filter((provider) => provider.linked) ?? [];
  const menuId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => () => controller.current?.abort(), []);

  if (!status.data?.enabled || linked.length === 0) return null;

  const run = async (provider: AiProviderId | undefined) => {
    if (busy) return;
    const started = fieldValue();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      await generate(provider, abort.signal);
      if (fieldValue() !== started && !abort.signal.aborted) {
        // The field moved on; whoever typed keeps their words.
        toast("The generated text was not applied because the field changed meanwhile.", "error");
      }
    } catch (error) {
      if (!abort.signal.aborted) toast(errorText(error, "Nothing was generated."), "error");
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  };

  const stop = () => controller.current?.abort();

  const entries: MenuEntry[] = linked.map((provider) => ({
    label: `${provider.label}${provider.linked?.accountLabel ? ` · ${provider.linked.accountLabel}` : ""}`,
    onSelect: () => void run(provider.id),
  }));

  const openMenu = () => {
    const menu = panel.current;
    const button = trigger.current;
    if (!menu || !button) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    const placed = placeAnchored(
      button.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { side: "bottom", align: "end" },
    );
    setStyle({ top: placed.top, left: placed.left });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  };

  return (
    <>
      <IconButton
        ref={trigger}
        label={
          busy
            ? "Stop generating"
            : reason
              ? `${label}: ${reason}`
              : linked.length > 1
                ? `${label} (choose a provider)`
                : label
        }
        icon={busy ? Square : icon}
        size={size}
        disabled={!busy && (disabled || reason !== undefined)}
        className={busy ? "text-error" : "text-brand"}
        onClick={() => {
          if (busy) return stop();
          if (linked.length > 1) return openMenu();
          void run(undefined);
        }}
      />
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="text-brand pointer-events-none absolute size-3 animate-spin opacity-0"
        />
      ) : null}
      {linked.length > 1 ? (
        <MenuPanel
          ref={panel}
          id={menuId}
          label={`${label} with`}
          entries={entries}
          style={style}
          onClose={() => panel.current?.hidePopover()}
        />
      ) : null}
    </>
  );
}

import { IconButton, type MenuEntry, MenuPanel, placeAnchored } from "@exeora/design/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, type LucideIcon, RefreshCw, Sparkles, Square } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { ApiError, errorText } from "../../api.js";
import {
  type AiOperation,
  type AiProviderId,
  type AiProviderView,
  aiApi,
  aiKeys,
  type ChatgptLoginMode,
} from "../../api-ai.js";
import { type LocalMachine, projectsApi } from "../../api-projects.js";
import type { Target } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import { ChatgptLoginDialog } from "./ChatgptLoginDialog.js";
import { ChatgptWelcomeDialog } from "./ChatgptWelcomeDialog.js";
import {
  CHATGPT_USAGE_URL,
  chatgptAccountLabel,
  chatgptLoginModeForStatus,
  chatgptStatusIsActionable,
} from "./chatgpt-state.js";
import { useChatgptWelcome } from "./useChatgptWelcome.js";

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
  target,
  operation,
  icon = Sparkles,
  generate,
  fieldValue,
  disabled = false,
  reason,
  size = "sm",
}: {
  label: string;
  /** The project/workspace whose machine will perform this generation. */
  target: Pick<Target, "projectId" | "workspace">;
  operation: AiOperation;
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
  const chatgptOffered =
    status.data?.providers.some((provider) => provider.id === "chatgpt") ?? false;
  const machines = useQuery({
    queryKey: ["machines", "stored"],
    queryFn: () => projectsApi.machines(),
    select: (page) => page.machines,
    enabled: chatgptOffered,
    refetchInterval: 15_000,
  });
  const projectStatus = useQuery({
    queryKey: aiKeys.chatgptProjectStatus(target.projectId, target.workspace),
    queryFn: () => aiApi.chatgptProjectStatus(target.projectId, target.workspace),
    enabled: chatgptOffered,
    retry: false,
    staleTime: 30_000,
  });
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lastProvider, setLastProvider] = useState<AiProviderId | undefined>();
  const [loginDevice, setLoginDevice] = useState<{
    id: string;
    name: string;
    mode: ChatgptLoginMode;
  } | null>(null);
  const [usageLimit, setUsageLimit] = useState(false);
  const { welcome, showWelcome, closeWelcome } = useChatgptWelcome();
  const controller = useRef<AbortController | null>(null);
  const localMachines = (machines.data ?? []).filter(
    (machine): machine is LocalMachine => machine.kind === "local" && machine.revokedAt === null,
  );
  const chatgptProvider = status.data?.providers.find((provider) => provider.id === "chatgpt");
  const targetChatgpt = chatgptStatusIsActionable(projectStatus.data) ? projectStatus.data : null;
  const linked: AiProviderView[] = [
    ...(status.data?.providers.filter((provider) => provider.linked && !provider.linked.legacy) ??
      []),
    ...(chatgptProvider && targetChatgpt
      ? [
          {
            ...chatgptProvider,
            linked: {
              kind: "oauth" as const,
              accountLabel: chatgptAccountLabel(targetChatgpt.account),
            },
          },
        ]
      : []),
  ];
  const menuId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => () => controller.current?.abort(), []);

  if (!status.data?.enabled) return null;
  if (linked.length === 0 && loginDevice === null) {
    if (!chatgptProvider || !projectStatus.isError) return null;
    return (
      <IconButton
        label="Retry ChatGPT connection"
        icon={RefreshCw}
        size={size}
        disabled={projectStatus.isFetching}
        onClick={() => void projectStatus.refetch()}
      />
    );
  }

  const run = async (provider: AiProviderId | undefined) => {
    if (busy) return;
    const started = fieldValue();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setLastProvider(provider);
    setUsageLimit(false);
    try {
      await generate(provider, abort.signal);
      if (fieldValue() !== started && !abort.signal.aborted) {
        // The field moved on; whoever typed keeps their words.
        toast("The generated text was not applied because the field changed meanwhile.", "error");
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (error instanceof ApiError && error.code === "ai_chatgpt_signin") {
          const deviceId = typeof error.body?.deviceId === "string" ? error.body.deviceId : null;
          if (deviceId) {
            const machine = localMachines.find((item) => item.deviceId === deviceId);
            const currentStatus = await aiApi
              .chatgptStatus(deviceId)
              .catch(() => projectStatus.data);
            if (abort.signal.aborted) return;
            setLoginDevice({
              id: deviceId,
              name: machine?.name ?? "your machine",
              mode: chatgptLoginModeForStatus(currentStatus),
            });
          } else {
            toast("Sign in with ChatGPT on the machine that runs this workspace.", "error");
          }
        } else if (error instanceof ApiError && error.code === "ai_usage_limit") {
          setUsageLimit(true);
        } else {
          toast(errorText(error, "Nothing was generated."), "error");
        }
      }
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
  const configuredProvider =
    status.data?.settings?.operations[operation].provider ?? status.data?.settings?.defaultProvider;
  const usingChatgpt =
    (lastProvider === "chatgpt" || (linked.length === 1 && linked[0]?.id === "chatgpt")) &&
    targetChatgpt?.state === "ready";

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
    <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-2">
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
          void run(configuredProvider ?? linked[0]?.id);
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
      {usingChatgpt ? (
        <span className="text-label-md text-foreground-faint inline-flex items-center gap-1">
          Using ChatGPT plan ·{" "}
          <a
            href={CHATGPT_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Manage usage
          </a>
        </span>
      ) : null}
      {usageLimit ? (
        <span
          role="alert"
          className="border-error/30 bg-error/8 text-body-md text-error basis-full rounded-lg border px-3 py-2"
        >
          Usage limit reached for {chatgptAccountLabel(targetChatgpt?.account) ?? "ChatGPT plan"}.{" "}
          <a
            href={CHATGPT_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            Manage usage
          </a>
        </span>
      ) : null}
      <ChatgptLoginDialog
        deviceId={loginDevice?.id ?? null}
        machineName={loginDevice?.name ?? "your machine"}
        mode={loginDevice?.mode ?? "new"}
        open={loginDevice !== null}
        onComplete={(result) => {
          if (loginDevice) showWelcome(loginDevice.id, result);
          setLoginDevice(null);
          void status.refetch();
          void machines.refetch();
          void projectStatus.refetch();
        }}
        onCancel={() => setLoginDevice(null)}
      />
      <ChatgptWelcomeDialog welcome={welcome} onDone={closeWelcome} />
    </span>
  );
}

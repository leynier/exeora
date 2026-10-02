import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../api.js";
import {
  type AiProviderId,
  type AiProviderView,
  type AiSettings,
  aiApi,
  aiKeys,
  type ChatgptLoginMode,
  type ChatgptStatus,
} from "../../api-ai.js";
import { type LocalMachine, projectsApi } from "../../api-projects.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { useToast } from "../toast.js";
import { Badge, Card, Divided, Row, SkeletonRows } from "../ui.js";
import { AiDeviceLoginDialog } from "./AiDeviceLoginDialog.js";
import { AiKeyDialog } from "./AiKeyDialog.js";
import {
  AiOperationSettingsForm,
  type ChatgptMachineOption,
  type ChatgptModelSource,
} from "./AiOperationSettingsForm.js";
import { ChatgptLoginDialog } from "./ChatgptLoginDialog.js";
import { ChatgptRow } from "./ChatgptMachineRows.js";
import { ChatgptWelcomeDialog } from "./ChatgptWelcomeDialog.js";
import { chatgptAccountLabel, chatgptStatusCanConfigure } from "./chatgpt-state.js";

type ChatgptLoginTarget = {
  deviceId: string;
  machineName: string;
  mode: ChatgptLoginMode;
};

/** The account-level AI links plus the local machines that can use ChatGPT. */
export function AiProvidersCard({ className = "" }: { className?: string }) {
  const status = useQuery({ queryKey: aiKeys.status, queryFn: aiApi.status, staleTime: 60_000 });
  const machines = useQuery({
    queryKey: ["machines", "stored"],
    queryFn: () => projectsApi.machines(),
    select: (page) => page.machines,
    enabled: status.data?.enabled === true,
    refetchInterval: 15_000,
  });
  const client = useQueryClient();
  const toast = useToast();
  const [linking, setLinking] = useState<AiProviderView | null>(null);
  const [keying, setKeying] = useState<AiProviderView | null>(null);
  const [unlinking, setUnlinking] = useState<AiProviderView | null>(null);
  const [chatgptLogin, setChatgptLogin] = useState<ChatgptLoginTarget | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [revocationWarning, setRevocationWarning] = useState<string | null>(null);

  const providers = status.data?.providers ?? [];
  const chatgpt = providers.find((provider) => provider.id === "chatgpt");
  const localMachines = useMemo(
    () =>
      (machines.data ?? []).filter(
        (machine): machine is LocalMachine =>
          machine.kind === "local" && machine.revokedAt === null,
      ),
    [machines.data],
  );
  const machineStatuses = useQueries({
    queries: localMachines.map((machine) => ({
      queryKey: aiKeys.chatgptStatus(machine.deviceId),
      queryFn: () => aiApi.chatgptStatus(machine.deviceId),
      enabled: chatgpt !== undefined && machine.online,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const machineRows = localMachines.map((machine, index) => ({
    machine,
    query: machineStatuses[index] ?? { data: undefined, error: undefined },
  }));
  const readyMachines = machineRows.filter((row) => row.query.data?.state === "ready");
  const [selectedChatgptMachineId, setSelectedChatgptMachineId] = useState("");
  useEffect(() => {
    if (!readyMachines.some((row) => row.machine.deviceId === selectedChatgptMachineId)) {
      setSelectedChatgptMachineId(readyMachines[0]?.machine.deviceId ?? "");
    }
  }, [readyMachines, selectedChatgptMachineId]);
  const selectedReadyMachine =
    readyMachines.find((row) => row.machine.deviceId === selectedChatgptMachineId) ??
    readyMachines[0];
  const modelQuery = useQuery({
    queryKey: aiKeys.chatgptModels(selectedReadyMachine?.machine.deviceId ?? ""),
    queryFn: () => aiApi.chatgptModels(selectedReadyMachine?.machine.deviceId ?? ""),
    enabled: chatgpt !== undefined && selectedReadyMachine !== undefined,
    retry: false,
    staleTime: 60_000,
  });
  const modelSources: ChatgptModelSource[] = selectedReadyMachine
    ? [
        {
          deviceId: selectedReadyMachine.machine.deviceId,
          machineName: selectedReadyMachine.machine.name,
          models: modelQuery.data?.models ?? [],
          loading: modelQuery.isLoading,
        },
      ]
    : [];
  const chatgptMachineOptions: ChatgptMachineOption[] = readyMachines.map(({ machine }) => ({
    deviceId: machine.deviceId,
    machineName: machine.name,
  }));

  const unlink = useMutation({
    mutationFn: (provider: AiProviderId) => aiApi.unlink(provider),
    onSuccess: (_result, provider) => {
      toast(`${label(provider)} is no longer linked.`);
      setUnlinking(null);
      void client.invalidateQueries({ queryKey: aiKeys.status });
    },
    onError: (error) => {
      toast(errorText(error, "The provider could not be unlinked."), "error");
      setUnlinking(null);
    },
  });
  const logout = useMutation({
    mutationFn: (deviceId: string) => aiApi.chatgptLogout(deviceId),
    onSuccess: (result, deviceId) => {
      if (result.revocationConfirmed) {
        toast("Signed out of ChatGPT on this machine.");
      } else {
        toast("Signed out here. OpenAI did not confirm revocation.", "error");
        setRevocationWarning(deviceId);
      }
      void client.invalidateQueries({ queryKey: aiKeys.chatgptStatus(deviceId) });
    },
    onError: (error) => toast(errorText(error, "ChatGPT could not be signed out."), "error"),
  });

  if (!status.data?.enabled) return null;
  const linked = providers.filter((provider) => provider.linked && !provider.linked.legacy);
  const settingsChatgptMachine = machineRows.find((row) =>
    chatgptStatusCanConfigure(row.query.data),
  );
  const settingsProviders = [
    ...linked,
    ...(chatgpt && settingsChatgptMachine
      ? [
          {
            ...chatgpt,
            linked: {
              kind: "oauth" as const,
              accountLabel: chatgptAccountLabel(settingsChatgptMachine.query.data?.account),
            },
          },
        ]
      : []),
  ];

  const completeChatgptLogin = (deviceId: string, result: ChatgptStatus) => {
    setChatgptLogin(null);
    void client.invalidateQueries({ queryKey: aiKeys.chatgptStatus(deviceId) });
    void client.invalidateQueries({ queryKey: aiKeys.status });
    if (result.account?.newRegistration && result.account?.planUsage) setWelcome(true);
  };
  const openAi = providers.find((provider) => provider.id === "openai");
  const cancelChatgptLogin = () => {
    const deviceId = chatgptLogin?.deviceId;
    setChatgptLogin(null);
    if (deviceId) void client.invalidateQueries({ queryKey: aiKeys.chatgptStatus(deviceId) });
  };

  return (
    <>
      <Card
        title="AI Assist"
        subtitle="Write commit messages and pull requests with your own AI accounts."
        className={className}
      >
        {status.isLoading || machines.isLoading ? (
          <SkeletonRows count={2} />
        ) : (
          <Divided>
            {providers
              .filter((provider) => provider.id !== "chatgpt")
              .map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  chatgptOffered={chatgpt === undefined}
                  settings={status.data?.settings}
                  onLink={() => setLinking(provider)}
                  onKey={() => setKeying(provider)}
                  onUnlink={() => setUnlinking(provider)}
                />
              ))}
            {chatgpt ? (
              <ChatgptRow
                rows={machineRows}
                warningDeviceId={revocationWarning}
                logoutPending={logout.isPending}
                onLogin={(deviceId, machineName, mode) =>
                  setChatgptLogin({ deviceId, machineName, mode })
                }
                onLogout={(deviceId) => logout.mutate(deviceId)}
                onUseApiKey={openAi ? () => setKeying(openAi) : undefined}
              />
            ) : null}
            {settingsProviders.length > 0 && status.data?.settings ? (
              <AiOperationSettingsForm
                providers={settingsProviders}
                settings={status.data.settings}
                chatgptModels={modelSources}
                chatgptMachines={chatgptMachineOptions}
                chatgptMachineId={selectedReadyMachine?.machine.deviceId ?? ""}
                onChatgptMachineChange={setSelectedChatgptMachineId}
              />
            ) : null}
          </Divided>
        )}
        <p className="text-body-md text-foreground-faint border-border-subtle border-t px-5 py-3">
          {chatgpt
            ? "Requests use your ChatGPT plan on the machine that runs them. Exeora never receives your ChatGPT tokens. "
            : "Your gateway has not enabled Sign in with ChatGPT. "}
          {providers.some((provider) => provider.id === "xai")
            ? "Grok's subscription sign-in is a provider flow that may change without notice; an API key still works. "
            : null}
          What a generation reads, the staged patch or the branch's commits, goes to the provider
          you chose and is kept by Exeora nowhere. Generations appear in Activity without their
          content.
        </p>
      </Card>
      <AiDeviceLoginDialog
        provider={linking?.id === "xai" ? linking.id : null}
        label={linking?.label ?? ""}
        onDone={() => setLinking(null)}
        onCancel={() => setLinking(null)}
      />
      <AiKeyDialog
        provider={keying}
        onDone={() => setKeying(null)}
        onCancel={() => setKeying(null)}
      />
      <ChatgptLoginDialog
        deviceId={chatgptLogin?.deviceId ?? null}
        machineName={chatgptLogin?.machineName ?? "your machine"}
        mode={chatgptLogin?.mode ?? "new"}
        open={chatgptLogin !== null}
        onComplete={(result) => chatgptLogin && completeChatgptLogin(chatgptLogin.deviceId, result)}
        onCancel={cancelChatgptLogin}
      />
      <ChatgptWelcomeDialog open={welcome} onDone={() => setWelcome(false)} />
      <ConfirmDialog
        open={unlinking !== null}
        title={`${unlinking?.linked?.legacy ? "Remove old sign-in" : `Unlink ${unlinking?.label ?? ""}`}?`}
        body={
          unlinking?.linked?.legacy
            ? "This removes the old unofficial ChatGPT sign-in. Sign in with ChatGPT on a machine, or use an OpenAI API key."
            : "The stored token or key is deleted. Linking again asks the provider afresh."
        }
        confirmLabel={unlinking?.linked?.legacy ? "Remove old link" : "Unlink"}
        pending={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking.id)}
        onCancel={() => setUnlinking(null)}
      />
    </>
  );
}

function ProviderRow({
  provider,
  chatgptOffered,
  settings,
  onLink,
  onKey,
  onUnlink,
}: {
  provider: AiProviderView;
  chatgptOffered: boolean;
  settings: AiSettings | null | undefined;
  onLink: () => void;
  onKey: () => void;
  onUnlink: () => void;
}) {
  const legacy = provider.linked?.legacy === true;
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-title-md">{label(provider.id)}</p>
          {legacy ? (
            <Badge tone="error">Old sign-in</Badge>
          ) : provider.linked ? (
            <Badge tone="success">
              {provider.linked.kind === "oauth" ? "subscription" : "API key"}
            </Badge>
          ) : (
            <Badge>not linked</Badge>
          )}
          {settings?.defaultProvider === provider.id && !legacy ? <Badge>default</Badge> : null}
        </div>
        <p className="text-body-md text-foreground-faint">
          {legacy
            ? "This link used an unofficial ChatGPT sign-in Exeora no longer supports. Sign in with ChatGPT on your machine, or use an API key."
            : provider.linked
              ? (provider.linked.accountLabel ??
                (provider.linked.kind === "oauth"
                  ? "Linked through your subscription."
                  : "Linked with an API key you pasted."))
              : chatgptOffered && provider.id === "openai"
                ? "Your gateway has not enabled Sign in with ChatGPT."
                : provider.authKinds.includes("oauth")
                  ? "Link your subscription with a provider sign-in, or paste an API key."
                  : "Paste an API key from the provider's platform."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {legacy ? (
          <>
            <button type="button" className="btn btn-danger" onClick={onUnlink}>
              Remove old link
            </button>
            <button type="button" className="btn" onClick={onKey}>
              Use an API key
            </button>
          </>
        ) : provider.linked ? (
          <button type="button" className="btn btn-danger" onClick={onUnlink}>
            Unlink
          </button>
        ) : (
          <>
            {provider.authKinds.includes("oauth") ? (
              <button type="button" className="btn btn-primary" onClick={onLink}>
                Link subscription
              </button>
            ) : null}
            {provider.authKinds.includes("api_key") ? (
              <button type="button" className="btn" onClick={onKey}>
                Use an API key
              </button>
            ) : null}
          </>
        )}
      </div>
    </Row>
  );
}

function label(provider: AiProviderId): string {
  if (provider === "openai") return "OpenAI API";
  if (provider === "chatgpt") return "ChatGPT plan";
  return "Grok";
}

export type { AiSettings };

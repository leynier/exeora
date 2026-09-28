import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api.js";
import {
  type AiProviderId,
  type AiProviderView,
  type AiSettings,
  aiApi,
  aiKeys,
} from "../../api-ai.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { useToast } from "../toast.js";
import { Badge, Card, Divided, Row, SkeletonRows } from "../ui.js";
import { AiDeviceLoginDialog } from "./AiDeviceLoginDialog.js";
import { AiKeyDialog } from "./AiKeyDialog.js";
import { AiOperationSettingsForm } from "./AiOperationSettingsForm.js";

/**
 * The assistants an account may write commits and pull requests with.
 *
 * Each provider is linked by its own subscription, through a device code, or
 * by an API key. Neither flow is one the providers document for a product
 * like this, which the card says in as many words; the gateway can be run
 * with the subscription flows off.
 */
export function AiProvidersCard({ className = "" }: { className?: string }) {
  const status = useQuery({ queryKey: aiKeys.status, queryFn: aiApi.status, staleTime: 60_000 });
  const client = useQueryClient();
  const toast = useToast();
  const [linking, setLinking] = useState<AiProviderView | null>(null);
  const [keying, setKeying] = useState<AiProviderView | null>(null);
  const [unlinking, setUnlinking] = useState<AiProviderView | null>(null);

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

  // Nothing on a gateway without AI Assist, as with GitHub.
  if (!status.data?.enabled) return null;
  const { providers, settings } = status.data;
  const linked = providers.filter((provider) => provider.linked);

  return (
    <>
      <Card
        title="AI Assist"
        subtitle="Write commit messages and pull requests with ChatGPT or Grok, linked to your own account."
        className={className}
      >
        {status.isLoading ? (
          <SkeletonRows count={2} />
        ) : (
          <Divided>
            {providers.map((provider) => (
              <Row key={provider.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-title-md">{provider.label}</p>
                    {provider.linked ? (
                      <Badge tone="success">
                        {provider.linked.kind === "oauth" ? "subscription" : "API key"}
                      </Badge>
                    ) : (
                      <Badge>not linked</Badge>
                    )}
                    {settings?.defaultProvider === provider.id && linked.length > 1 ? (
                      <Badge>default</Badge>
                    ) : null}
                  </div>
                  <p className="text-body-md text-foreground-faint">
                    {provider.linked
                      ? (provider.linked.accountLabel ??
                        (provider.linked.kind === "oauth"
                          ? "Linked through your subscription."
                          : "Linked with an API key you pasted."))
                      : provider.authKinds.includes("oauth")
                        ? "Link your subscription with a device code, or paste an API key."
                        : "Paste an API key from the provider's platform."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {provider.linked ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setUnlinking(provider)}
                    >
                      Unlink
                    </button>
                  ) : (
                    <>
                      {provider.authKinds.includes("oauth") ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => setLinking(provider)}
                        >
                          Link subscription
                        </button>
                      ) : null}
                      {provider.authKinds.includes("api_key") ? (
                        <button type="button" className="btn" onClick={() => setKeying(provider)}>
                          Use an API key
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </Row>
            ))}
            {linked.length > 0 && settings ? (
              <AiOperationSettingsForm providers={linked} settings={settings} />
            ) : null}
          </Divided>
        )}
        <p className="text-body-md text-foreground-faint border-border-subtle border-t px-5 py-3">
          The subscription flows reuse the providers' own sign-in for their command-line tools and
          are not something either provider documents for third parties; they may stop working
          without notice, in which case an API key still does. What a generation reads, the staged
          patch or the branch's commits, goes to the provider you chose and is kept by Exeora
          nowhere. Generations appear in Activity without their content.
        </p>
      </Card>
      <AiDeviceLoginDialog
        provider={linking?.id ?? null}
        label={linking?.label ?? ""}
        onDone={() => setLinking(null)}
        onCancel={() => setLinking(null)}
      />
      <AiKeyDialog
        provider={keying}
        onDone={() => setKeying(null)}
        onCancel={() => setKeying(null)}
      />
      <ConfirmDialog
        open={unlinking !== null}
        title={`Unlink ${unlinking?.label ?? ""}?`}
        body="The stored token or key is deleted. Linking again asks the provider afresh."
        confirmLabel="Unlink"
        pending={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking.id)}
        onCancel={() => setUnlinking(null)}
      />
    </>
  );
}

function label(provider: AiProviderId): string {
  return provider === "openai" ? "ChatGPT" : "Grok";
}

export type { AiSettings };

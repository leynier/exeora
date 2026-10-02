import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import {
  AI_OPERATIONS,
  AI_PROVIDER_IDS,
  type AiOperation,
  type AiProviderId,
} from "../db/schema-ai.js";
import "../env.js";
import { isModelId } from "./catalog.js";

/**
 * What the person asked of each operation: which provider and model write
 * it, and what else to tell them. Absent means the gateway's default, which
 * is the account's default provider and the first curated model.
 */

/** The most a person may add to a prompt. Enough for a style guide, not a novel. */
export const MAX_INSTRUCTIONS = 4000;

export type SettingsProviderId = AiProviderId | "chatgpt";

export interface OperationSettings {
  provider: SettingsProviderId | null;
  model: string | null;
  instructions: string | null;
}

export interface AiSettingsView {
  defaultProvider: SettingsProviderId | null;
  operations: Record<AiOperation, OperationSettings>;
}

const providerId = z.enum(AI_PROVIDER_IDS);
const operationPatch = z.object({
  provider: providerId.nullable().optional(),
  model: z.string().trim().max(128).refine(isModelId, "not a model id").nullable().optional(),
  instructions: z.string().max(MAX_INSTRUCTIONS).nullable().optional(),
});

/** What `PUT /api/ai/settings` takes. A field left out is left as it was; null clears it. */
export const SettingsPatch = z.object({
  defaultProvider: providerId.nullable().optional(),
  operations: z
    .object({ commit: operationPatch.optional(), pull_request: operationPatch.optional() })
    .optional(),
});

export type SettingsPatch = z.infer<typeof SettingsPatch>;

export class RetiredPlanChoiceError extends Error {
  constructor() {
    super("Choose a linked provider to replace the previous ChatGPT plan connection.");
  }
}

const EMPTY: OperationSettings = { provider: null, model: null, instructions: null };

export async function readSettings(env: Pick<Env, "DB">, userId: string): Promise<AiSettingsView> {
  const database = db(env);
  const account = await database
    .select({ defaultProvider: schema.aiSettings.defaultProvider })
    .from(schema.aiSettings)
    .where(eq(schema.aiSettings.userId, userId))
    .get();
  const rows = await database
    .select()
    .from(schema.aiOperationSettings)
    .where(eq(schema.aiOperationSettings.userId, userId))
    .all();
  const hasLocalChoice =
    wasLocalChatgpt(account?.defaultProvider) || rows.some((row) => wasLocalChatgpt(row.provider));
  const linked = hasLocalChoice
    ? await database
        .select({ kind: schema.aiProviders.authKind })
        .from(schema.aiProviders)
        .where(
          and(eq(schema.aiProviders.userId, userId), eq(schema.aiProviders.provider, "openai")),
        )
        .get()
    : undefined;
  const restorePlan = linked?.kind !== "api_key";
  const operations = Object.fromEntries(
    AI_OPERATIONS.map((operation) => {
      const row = rows.find((candidate) => candidate.operation === operation);
      return [
        operation,
        row
          ? {
              provider: restoredProvider(row.provider, restorePlan),
              model:
                restorePlan &&
                (wasLocalChatgpt(row.provider) ||
                  (row.provider === null && wasLocalChatgpt(account?.defaultProvider)))
                  ? null
                  : row.model,
              instructions: row.instructions === "" ? null : row.instructions,
            }
          : EMPTY,
      ];
    }),
  ) as Record<AiOperation, OperationSettings>;
  return { defaultProvider: restoredProvider(account?.defaultProvider, restorePlan), operations };
}

// Retain the person's ChatGPT choice after retiring the per-machine provider.
// Model names belong to its former catalog, so use the restored catalog's default.
function wasLocalChatgpt(provider: string | null | undefined): boolean {
  return provider === "chatgpt";
}

function restoredProvider(
  provider: string | null | undefined,
  restorePlan: boolean,
): SettingsProviderId | null {
  if (wasLocalChatgpt(provider)) return restorePlan ? "openai" : "chatgpt";
  return AI_PROVIDER_IDS.find((id) => id === provider) ?? null;
}

export async function writeSettings(
  env: Pick<Env, "DB">,
  userId: string,
  patch: SettingsPatch,
): Promise<AiSettingsView> {
  const database = db(env);
  const saved = await readSettings(env, userId);
  const replacements = [
    [saved.defaultProvider, patch.defaultProvider],
    ...AI_OPERATIONS.map((operation) => [
      saved.operations[operation].provider,
      patch.operations?.[operation]?.provider,
    ]),
  ].filter(([previous, next]) => previous === "chatgpt" && next !== undefined);
  if (replacements.length > 0) {
    const linked = await database
      .select({ provider: schema.aiProviders.provider })
      .from(schema.aiProviders)
      .where(eq(schema.aiProviders.userId, userId))
      .all();
    if (replacements.some(([, next]) => !linked.some((row) => row.provider === next))) {
      throw new RetiredPlanChoiceError();
    }
  }
  // Canonicalize before applying patches: a newly supplied model must survive.
  // D1 batches are atomic, and this only updates the retired provider's choices.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE ai_operation_settings SET model = NULL, provider = CASE WHEN provider = 'chatgpt' THEN 'openai' ELSE provider END WHERE user_id = ? AND (provider = 'chatgpt' OR (provider IS NULL AND EXISTS (SELECT 1 FROM ai_settings WHERE user_id = ? AND default_provider = 'chatgpt'))) AND NOT EXISTS (SELECT 1 FROM ai_providers WHERE user_id = ? AND provider = 'openai' AND auth_kind = 'api_key')",
    ).bind(userId, userId, userId),
    env.DB.prepare(
      "UPDATE ai_settings SET default_provider = 'openai' WHERE user_id = ? AND default_provider = 'chatgpt' AND NOT EXISTS (SELECT 1 FROM ai_providers WHERE user_id = ? AND provider = 'openai' AND auth_kind = 'api_key')",
    ).bind(userId, userId),
  ]);
  if (patch.defaultProvider !== undefined) {
    await database
      .insert(schema.aiSettings)
      .values({ userId, defaultProvider: patch.defaultProvider })
      .onConflictDoUpdate({
        target: schema.aiSettings.userId,
        set: { defaultProvider: patch.defaultProvider },
      })
      .run();
  }
  for (const operation of AI_OPERATIONS) {
    const change = patch.operations?.[operation];
    if (!change) continue;
    const values = {
      ...(change.provider !== undefined ? { provider: change.provider } : {}),
      ...(change.model !== undefined ? { model: change.model === "" ? null : change.model } : {}),
      ...(change.instructions !== undefined
        ? { instructions: change.instructions?.trim() ? change.instructions : null }
        : {}),
    };
    if (Object.keys(values).length === 0) continue;
    await database
      .insert(schema.aiOperationSettings)
      .values({ userId, operation, ...values })
      .onConflictDoUpdate({
        target: [schema.aiOperationSettings.userId, schema.aiOperationSettings.operation],
        set: values,
      })
      .run();
  }
  return readSettings(env, userId);
}

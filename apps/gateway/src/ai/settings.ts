import { eq } from "drizzle-orm";
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

export interface OperationSettings {
  provider: AiProviderId | null;
  model: string | null;
  instructions: string | null;
}

export interface AiSettingsView {
  defaultProvider: AiProviderId | null;
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
  const operations = Object.fromEntries(
    AI_OPERATIONS.map((operation) => {
      const row = rows.find((candidate) => candidate.operation === operation);
      return [
        operation,
        row
          ? {
              provider: row.provider,
              model: row.model,
              instructions: row.instructions === "" ? null : row.instructions,
            }
          : EMPTY,
      ];
    }),
  ) as Record<AiOperation, OperationSettings>;
  return { defaultProvider: account?.defaultProvider ?? null, operations };
}

export async function writeSettings(
  env: Pick<Env, "DB">,
  userId: string,
  patch: SettingsPatch,
): Promise<AiSettingsView> {
  const database = db(env);
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

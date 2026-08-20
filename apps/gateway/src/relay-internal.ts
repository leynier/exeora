import {
  CommandPolicy,
  ERROR_CODES,
  MAX_APPROVAL_PROMPT_LENGTH,
  TOOL_NAMES,
  WorkspaceAction,
  WorkspaceValue,
} from "@exeora/protocol";
import { z } from "zod";

const client = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
  })
  .optional();

const wireError = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

const toolResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: wireError }),
]);

export const CallerRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool.start"),
    requestId: z.string(),
    projectId: z.string(),
    worktreeId: z.string().optional(),
    worktreeSlug: z.string().optional(),
    tool: z.enum(TOOL_NAMES),
    arguments: z.unknown(),
    client,
    policy: CommandPolicy.optional(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  }),
  z.object({
    type: z.literal("approval.start"),
    id: z.string(),
    projectId: z.string(),
    worktreeId: z.string().optional(),
    worktreeSlug: z.string().optional(),
    tool: z.enum(TOOL_NAMES),
    prompt: z.string().max(MAX_APPROVAL_PROMPT_LENGTH),
    clientName: z.string().max(256).optional(),
    client,
    requestedAt: z.number().int(),
    expiresAt: z.number().int(),
  }),
  z.object({
    type: z.literal("workspace.start"),
    requestId: z.string(),
    projectId: z.string(),
    worktreeId: z.string().optional(),
    worktreeSlug: z.string().optional(),
    action: WorkspaceAction,
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  }),
  z.object({ type: z.literal("cancel") }),
]);

export const CallerResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool.result"), result: toolResult }),
  z.object({
    type: z.literal("workspace.result"),
    result: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: WorkspaceValue }),
      z.object({ ok: z.literal(false), error: wireError }),
    ]),
  }),
  z.object({ type: z.literal("error"), error: wireError }),
  z.object({
    type: z.literal("approval.result"),
    outcome: z.enum(["approved", "declined", "unanswered"]),
  }),
]);

export type CallerRequest = z.infer<typeof CallerRequest>;
export type CallerResponse = z.infer<typeof CallerResponse>;

export function decodeCallerRequest(raw: string): CallerRequest | null {
  return decode(CallerRequest, raw);
}

export function decodeCallerResponse(raw: string): CallerResponse | null {
  return decode(CallerResponse, raw);
}

function decode<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

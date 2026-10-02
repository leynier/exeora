import { z } from "zod";

/**
 * Device-level Sign in with ChatGPT actions.
 *
 * These values are intentionally separate from the generic workspace reads
 * and mutations. A ChatGPT plan credential belongs to the machine, so the
 * gateway sends these actions only through its dedicated AI routes.
 */

export const CHATGPT_MAX_OUTPUT_CHARS = 200_000;
/** The prompt builder's 200k patch cap plus its bounded context and instructions. */
export const CHATGPT_MAX_INPUT_CHARS = 220_000;
export const CHATGPT_MAX_INSTRUCTIONS_CHARS = 4_000;
export const CHATGPT_MAX_MODELS = 50;

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const modelId = z.string().min(1).max(128).regex(MODEL_ID_PATTERN);
const boundedLabel = z.string().min(1).max(256);
const boundedCode = z.string().min(1).max(128);

const OFFICIAL_AUTHORIZE_URL =
  /^https:\/\/auth\.openai\.com\/api\/accounts\/authorize(?:\?[^#]*)?$/;
const SENSITIVE_AUTHORIZE_QUERY_KEYS = new Set([
  "id_token_hint",
  "access_token",
  "refresh_token",
  "id_token",
  "code_verifier",
  "code",
]);

function containsSensitiveAuthorizeQuery(value: string): boolean {
  const query = value.slice(value.indexOf("?") + 1);
  return query.split("&").some((part) => {
    const rawKey = part.split("=", 1)[0] ?? "";
    try {
      return SENSITIVE_AUTHORIZE_QUERY_KEYS.has(
        decodeURIComponent(rawKey.replaceAll("+", " ")).toLowerCase(),
      );
    } catch {
      return true;
    }
  });
}

/**
 * The relay accepts only the official authorize endpoint. Consumers must
 * repeat this check before opening a URL because a URL is an untrusted value
 * once it crosses a process boundary.
 */
export const ChatgptAuthorizeUrl = z
  .string()
  .max(4_096)
  .url()
  .refine(
    (value) => OFFICIAL_AUTHORIZE_URL.test(value) && !containsSensitiveAuthorizeQuery(value),
    "must use the official OpenAI authorize endpoint",
  );

export type ChatgptStatusState =
  | "signed_out"
  | "pending"
  | "ready"
  | "plan_disabled"
  | "reconnect"
  | "client_invalid"
  | "unavailable_on_cloud";

export const ChatgptStatusState = z.enum([
  "signed_out",
  "pending",
  "ready",
  "plan_disabled",
  "reconnect",
  "client_invalid",
  "unavailable_on_cloud",
]);

/** Safe, content-free reason left by a completed OAuth attempt. */
export const ChatgptLoginError = z.enum([
  "login_timeout",
  "state_mismatch",
  "plan_disabled",
  "missing_code",
  "registration_incomplete",
  "client_mismatch",
  "temporarily_unavailable",
  "invalid_token_response",
  "invalid_id_token",
  "subject_mismatch",
  "reconnect",
  "client_invalid",
  "cancelled",
]);

export type ChatgptLoginError = z.infer<typeof ChatgptLoginError>;

/** Public account information. Never add token, client ID, host ID or ID token fields here. */
export const ChatgptAccount = z.strictObject({
  label: boundedLabel,
  email: z.string().min(1).max(320).nullable(),
  scopes: z.array(z.string().min(1).max(128)).max(16),
  planUsage: z.boolean(),
  newRegistration: z.boolean(),
  /** Opaque registration notice ID for acknowledging the displayed welcome. */
  noticeId: z.uuid().optional(),
});

export type ChatgptAccount = z.infer<typeof ChatgptAccount>;

export const ChatgptPending = z.object({
  /** Unix epoch milliseconds at which the loopback authorization attempt expires. */
  expiresAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type ChatgptPending = z.infer<typeof ChatgptPending>;

export const ChatgptStatus = z.object({
  kind: z.literal("chatgpt_status"),
  state: ChatgptStatusState,
  account: ChatgptAccount.optional(),
  pending: ChatgptPending.optional(),
  loginError: ChatgptLoginError.optional(),
});

export type ChatgptStatus = z.infer<typeof ChatgptStatus>;

export const ChatgptLoginMode = z.enum(["new", "reauth", "enable_plan"]);
export type ChatgptLoginMode = z.infer<typeof ChatgptLoginMode>;

export const ChatgptLogin = z.object({
  kind: z.literal("chatgpt_login"),
  authorizeUrl: ChatgptAuthorizeUrl,
  expiresAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type ChatgptLogin = z.infer<typeof ChatgptLogin>;

export const ChatgptLogout = z.object({
  kind: z.literal("chatgpt_logout"),
  revocationConfirmed: z.boolean(),
});

export type ChatgptLogout = z.infer<typeof ChatgptLogout>;

export const ChatgptWelcomeAck = z.object({
  kind: z.literal("chatgpt_welcome_ack"),
  acknowledged: z.boolean(),
});

export const ChatgptModel = z.object({
  id: modelId,
  label: boundedLabel,
});

export type ChatgptModel = z.infer<typeof ChatgptModel>;

export const ChatgptModels = z.object({
  kind: z.literal("chatgpt_models"),
  models: z.array(ChatgptModel).max(CHATGPT_MAX_MODELS),
});

export type ChatgptModels = z.infer<typeof ChatgptModels>;

export const ChatgptGenerationReason = z.enum([
  "usage_limit",
  "not_eligible",
  "plan_disabled",
  "reconnect",
  "unsupported",
  "route_not_supported",
  "permission",
  "region_or_policy",
  "temporarily_unavailable",
  "incomplete",
  "interrupted",
  "model_unavailable",
  "signed_out",
  "failed",
]);

export type ChatgptGenerationReason = z.infer<typeof ChatgptGenerationReason>;

const ChatgptGenerationCompleted = z.object({
  kind: z.literal("chatgpt_generation"),
  outcome: z.literal("completed"),
  text: z.string().max(CHATGPT_MAX_OUTPUT_CHARS),
  model: modelId,
});

const ChatgptGenerationFailed = z.object({
  kind: z.literal("chatgpt_generation"),
  outcome: z.literal("failed"),
  reason: ChatgptGenerationReason,
  code: boundedCode.optional(),
  param: boundedCode.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  requestId: boundedCode.optional(),
});

export const ChatgptGeneration = z.discriminatedUnion("outcome", [
  ChatgptGenerationCompleted,
  ChatgptGenerationFailed,
]);

export type ChatgptGeneration = z.infer<typeof ChatgptGeneration>;

export const CHATGPT_ACTIONS = [
  z.object({ action: z.literal("chatgpt_status") }),
  z.object({ action: z.literal("chatgpt_login_start"), mode: ChatgptLoginMode }),
  z.object({ action: z.literal("chatgpt_login_cancel") }),
  z.object({ action: z.literal("chatgpt_logout") }),
  z.object({ action: z.literal("chatgpt_welcome_ack"), noticeId: z.uuid() }),
  z.object({ action: z.literal("chatgpt_models") }),
  z.object({
    action: z.literal("chatgpt_generate"),
    model: modelId.optional(),
    instructions: z.string().max(CHATGPT_MAX_INSTRUCTIONS_CHARS),
    input: z.string().max(CHATGPT_MAX_INPUT_CHARS),
  }),
] as const;

export type ChatgptAction = z.infer<(typeof CHATGPT_ACTIONS)[number]>;

export const CHATGPT_VALUES = [
  ChatgptStatus,
  ChatgptLogin,
  ChatgptLogout,
  ChatgptWelcomeAck,
  ChatgptModels,
  ChatgptGeneration,
] as const;

export type ChatgptValue = z.infer<(typeof CHATGPT_VALUES)[number]>;

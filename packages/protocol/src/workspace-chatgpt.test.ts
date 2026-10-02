import { describe, expect, it } from "vitest";
import {
  CHATGPT_MAX_OUTPUT_CHARS,
  ChatgptAuthorizeUrl,
  ChatgptGeneration,
  ChatgptModels,
  ChatgptStatus,
} from "./workspace-chatgpt.js";

describe("ChatGPT workspace protocol", () => {
  it("accepts a verified account without optional email metadata", () => {
    expect(
      ChatgptStatus.safeParse({
        kind: "chatgpt_status",
        state: "ready",
        account: {
          label: "ChatGPT account",
          email: null,
          scopes: ["openid", "chatgpt.tokens.use.direct"],
          planUsage: true,
          newRegistration: false,
        },
      }).success,
    ).toBe(true);
  });

  it("accepts only the official HTTPS authorize endpoint", () => {
    expect(
      ChatgptAuthorizeUrl.safeParse(
        "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=abc",
      ).success,
    ).toBe(true);
    for (const url of [
      "http://auth.openai.com/api/accounts/authorize?state=abc",
      "https://evil.example/api/accounts/authorize?state=abc",
      "https://auth.openai.com/oauth/authorize?state=abc",
      "https://auth.openai.com:8443/api/accounts/authorize?state=abc",
      "https://auth.openai.com/api/accounts/authorize?state=abc#token",
      "https://auth.openai.com/api/accounts/authorize?id_token_hint=secret",
      "https://auth.openai.com/api/accounts/authorize?state=abc&code_verifier=secret",
      "https://auth.openai.com/api/accounts/authorize?%69d_token_hint=secret",
    ]) {
      expect(ChatgptAuthorizeUrl.safeParse(url).success, url).toBe(false);
    }
  });

  it("keeps account DTOs free of credential material", () => {
    expect(
      ChatgptStatus.safeParse({
        kind: "chatgpt_status",
        state: "pending",
        pending: { expiresAt: 1_792_000_000_000 },
      }).success,
    ).toBe(true);
    const parsed = ChatgptStatus.safeParse({
      kind: "chatgpt_status",
      state: "ready",
      account: {
        label: "person@example.com",
        email: "person@example.com",
        scopes: ["openid", "chatgpt.tokens.use.direct"],
        planUsage: true,
        newRegistration: false,
        accessToken: "must-not-cross-the-relay",
        clientId: "must-not-cross-the-relay",
      },
    });
    expect(parsed.success).toBe(false);
    expect(
      ChatgptStatus.safeParse({
        kind: "chatgpt_status",
        state: "signed_out",
        loginError: "state_mismatch",
      }).success,
    ).toBe(true);
    expect(
      ChatgptStatus.safeParse({
        kind: "chatgpt_status",
        state: "signed_out",
        loginError: "provider_body_leaked",
      }).success,
    ).toBe(false);
  });

  it("bounds models and generation output", () => {
    expect(
      ChatgptModels.safeParse({
        kind: "chatgpt_models",
        models: Array.from({ length: 51 }, (_, index) => ({
          id: `model-${index}`,
          label: "Model",
        })),
      }).success,
    ).toBe(false);
    expect(
      ChatgptGeneration.safeParse({
        kind: "chatgpt_generation",
        outcome: "completed",
        text: "x".repeat(CHATGPT_MAX_OUTPUT_CHARS),
        model: "gpt-5",
      }).success,
    ).toBe(true);
    expect(
      ChatgptGeneration.safeParse({
        kind: "chatgpt_generation",
        outcome: "completed",
        text: "x".repeat(CHATGPT_MAX_OUTPUT_CHARS + 1),
        model: "gpt-5",
      }).success,
    ).toBe(false);
  });
});

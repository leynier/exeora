import { describe, expect, it } from "vitest";
import { ApiError } from "../../api.js";
import type { ChatgptLoginError, ChatgptStatus } from "../../api-ai.js";
import {
  chatgptAuthorizeUrl,
  chatgptLoginErrorCopy,
  chatgptLoginModeForStatus,
  chatgptMachineAvailability,
  chatgptStateCopy,
  chatgptStatusCanConfigure,
  chatgptStatusIsActionable,
} from "./chatgpt-state.js";

const chatgptStatus = (
  state: ChatgptStatus["state"],
  account = false,
  loginError?: ChatgptLoginError,
): ChatgptStatus => ({
  state,
  ...(loginError ? { loginError } : {}),
  ...(account
    ? {
        account: {
          label: "Ada",
          email: "ada@example.com",
          scopes: [],
          planUsage: true,
          newRegistration: false,
        },
      }
    : {}),
});

describe("ChatGPT dashboard boundaries", () => {
  it("accepts only the documented authorization endpoint", () => {
    expect(
      chatgptAuthorizeUrl(
        "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=abc",
      ),
    ).toBe(
      "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=abc",
    );
  });

  it.each([
    "http://auth.openai.com/api/accounts/authorize?state=abc",
    "https://evil.example/api/accounts/authorize?state=abc",
    "https://auth.openai.com:8443/api/accounts/authorize?state=abc",
    "https://user@auth.openai.com/api/accounts/authorize?state=abc",
    "https://auth.openai.com/other?state=abc",
    "https://auth.openai.com/api/accounts/authorize?id_token_hint=secret&state=abc",
    "https://auth.openai.com/api/accounts/authorize?state=abc#token",
    "javascript:alert(1)",
  ])("rejects an unsafe authorization URL: %s", (value) => {
    expect(chatgptAuthorizeUrl(value)).toBeUndefined();
  });

  it("maps gateway capability errors to actionable machine states", () => {
    expect(chatgptMachineAvailability(new ApiError(409, { error: "ai_update_cli" }))).toBe(
      "update",
    );
    expect(chatgptMachineAvailability(new ApiError(409, { error: "ai_machine_offline" }))).toBe(
      "offline",
    );
    expect(chatgptMachineAvailability(new ApiError(500, { error: "unknown" }))).toBe(
      "status_error",
    );
  });

  it("keeps the exact action copy for a signed-out machine", () => {
    expect(chatgptStateCopy("signed_out", "Work laptop")).toBe(
      "Use your ChatGPT plan for commit messages and pull requests on Work laptop.",
    );
  });

  it.each([
    ["login_timeout", "ChatGPT sign-in timed out. Start again."],
    ["state_mismatch", "ChatGPT sign-in could not be verified. Start again."],
    ["plan_disabled", "You signed in but did not allow ChatGPT plan usage."],
    ["missing_code", "ChatGPT sign-in could not be completed. Start again."],
    ["registration_incomplete", "ChatGPT sign-in could not be completed. Start again."],
    ["client_mismatch", "ChatGPT sign-in could not be completed. Start again."],
    ["temporarily_unavailable", "ChatGPT is temporarily unavailable. Try again shortly."],
    ["invalid_token_response", "ChatGPT sign-in could not be completed. Start again."],
    ["invalid_id_token", "ChatGPT sign-in could not be completed. Start again."],
    ["subject_mismatch", "ChatGPT sign-in could not be completed. Start again."],
    ["reconnect", "ChatGPT no longer accepts this machine's session."],
    ["client_invalid", "This machine's ChatGPT registration is no longer valid."],
    ["cancelled", "ChatGPT sign-in was cancelled."],
  ] as const)("keeps login error %s content-free", (code, copy) => {
    expect(chatgptLoginErrorCopy(code)).toBe(copy);
  });

  it.each([
    [chatgptStatus("signed_out"), "new"],
    [chatgptStatus("signed_out", true), "reauth"],
    [chatgptStatus("reconnect"), "reauth"],
    [chatgptStatus("client_invalid"), "new"],
    [chatgptStatus("signed_out", true, "client_invalid"), "new"],
    [chatgptStatus("ready", true, "state_mismatch"), "reauth"],
  ] as const)("chooses %s for a recoverable registration", (status, mode) => {
    expect(chatgptLoginModeForStatus(status)).toBe(mode);
  });

  it("only treats local recoverable states as actionable", () => {
    expect(chatgptStatusIsActionable(chatgptStatus("ready"))).toBe(true);
    expect(chatgptStatusIsActionable(chatgptStatus("signed_out"))).toBe(true);
    expect(chatgptStatusIsActionable(chatgptStatus("unavailable_on_cloud"))).toBe(false);
    expect(chatgptStatusIsActionable(undefined)).toBe(false);
    expect(chatgptStatusCanConfigure(chatgptStatus("ready"))).toBe(true);
    expect(chatgptStatusCanConfigure(chatgptStatus("signed_out"))).toBe(true);
    expect(chatgptStatusCanConfigure(chatgptStatus("reconnect"))).toBe(false);
  });
});

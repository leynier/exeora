import { describe, expect, it } from "vitest";
import type { AiProviderView } from "../../api-ai.js";
import { defaultProviderOnSave } from "./AiOperationSettingsForm.js";

const chatgpt: AiProviderView = {
  id: "chatgpt",
  label: "ChatGPT plan",
  authKinds: [],
  linked: { kind: "oauth", accountLabel: null },
  models: [],
  machineBound: true,
};

const openai: AiProviderView = {
  id: "openai",
  label: "OpenAI API",
  authKinds: ["api_key"],
  linked: { kind: "api_key", accountLabel: "OpenAI" },
  models: [],
};

describe("AI settings provider persistence", () => {
  it("persists ChatGPT when it is the only usable provider", () => {
    expect(defaultProviderOnSave(null, [chatgpt])).toBe("chatgpt");
  });

  it("preserves an existing explicit provider choice", () => {
    expect(defaultProviderOnSave("openai", [chatgpt])).toBe("openai");
    expect(defaultProviderOnSave(null, [openai])).toBeNull();
  });
});

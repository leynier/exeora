import { describe, expect, it } from "vitest";
import { chatCompletionText, MAX_OUTPUT_TEXT_CHARS, outputItemsText, outputText } from "./http.js";

describe("AI provider output limits", () => {
  it("rejects an oversized non-streaming response before returning it", () => {
    const text = "x".repeat(MAX_OUTPUT_TEXT_CHARS + 1);
    expect(() => outputText({ output_text: text })).toThrow("too much text");
    expect(() => chatCompletionText({ choices: [{ message: { content: text } }] })).toThrow(
      "too much text",
    );
    expect(() =>
      outputItemsText([{ type: "message", content: [{ type: "output_text", text }] }]),
    ).toThrow("too much text");
  });
});

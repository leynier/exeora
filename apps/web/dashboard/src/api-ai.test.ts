import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api.js";
import { aiApi } from "./api-ai.js";

vi.mock("./api.js", () => ({ request: vi.fn() }));

const mockedRequest = vi.mocked(request);

describe("ChatGPT dashboard API", () => {
  beforeEach(() => mockedRequest.mockReset());

  it("starts a device login with the explicit mode and encoded device id", async () => {
    mockedRequest.mockResolvedValue({
      authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
    });

    await aiApi.chatgptLogin("machine/laptop", "enable_plan");

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/devices/machine%2Flaptop/ai/chatgpt/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "enable_plan" }),
      }),
    );
  });

  it("keeps project status and model requests on the selected workspace", async () => {
    mockedRequest.mockResolvedValue({ state: "ready" });

    await aiApi.chatgptProjectStatus("project/one", "feature/chatgpt");
    await aiApi.chatgptProjectModels("project/one", "feature/chatgpt");

    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%2Fone/ai/chatgpt?workspace=feature%2Fchatgpt",
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%2Fone/ai/chatgpt/models?workspace=feature%2Fchatgpt",
    );
  });
});

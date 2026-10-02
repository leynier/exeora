import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api } from "./index.js";

const actions = [
  { action: "chatgpt_status" },
  { action: "chatgpt_login_start", mode: "new" },
  { action: "chatgpt_login_cancel" },
  { action: "chatgpt_logout" },
  { action: "chatgpt_models" },
  { action: "chatgpt_generate", instructions: "Describe the change.", input: "A staged patch." },
];

function call(endpoint: string, action: unknown) {
  const context = createExecutionContext();
  (context as { props?: unknown }).props = {
    userId: "usr_chatgpt_boundary",
    scopes: ["dashboard:manage"],
  };
  return api.fetch(
    new Request(`https://exeora.dev/api/projects/prj_unused/workspace/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }),
    env,
    context,
  );
}

describe("ChatGPT plan usage has a dedicated API boundary", () => {
  it.each(actions)("blocks $action on the generic workspace action route", async (action) => {
    const response = await call("actions", action);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "use_ai_endpoint" });
  });

  it.each(actions)("excludes $action from generic workspace reads", async (action) => {
    expect((await call("reads", action)).status).toBe(400);
  });
});

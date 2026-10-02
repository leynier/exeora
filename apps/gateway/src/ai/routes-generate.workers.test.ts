import { env } from "cloudflare:test";
import type { WorkspaceValue } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { storeCredential } from "./credentials.js";
import {
  type Asked,
  aiOff,
  aiOn,
  attachMachine,
  CREDENTIALS_KEY,
  call,
  fakeProvider,
  seedUser,
} from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";
import { writeSettings } from "./settings.js";

/**
 * A commit message and a pull request out of what the machine reads. The
 * machine is a fake CLI on the relay, the provider a function, and what
 * reaches the audit trail is checked to be the event and nothing more.
 */

const OWNER = "usr_ai_generate";
const OTHER = "usr_ai_generate_other";
const DEVICE = "dev_ai_generate";
const PROJECT = "prj_ai_generate";
const KEY = { credentialsKey: CREDENTIALS_KEY };

const STAGED: WorkspaceValue = {
  kind: "staged_context",
  branch: "feature/login",
  files: [{ path: "src/login.ts", status: "M", additions: 12, deletions: 3, binary: false }],
  patch: "diff --git a/src/login.ts b/src/login.ts\n+export function login() {}",
  truncated: false,
};

const RANGE: WorkspaceValue = {
  kind: "range_context",
  base: "main",
  head: "feature/login",
  mergeBase: "abc1234",
  commits: [{ oid: "def4567890", subject: "Add login", body: "", author: "Person" }],
  files: [{ path: "src/login.ts", status: "A", additions: 12, deletions: 0, binary: false }],
  patch: "diff --git a/src/login.ts b/src/login.ts\n+export function login() {}",
  truncated: false,
};

const EMPTY: WorkspaceValue = {
  kind: "staged_context",
  branch: "main",
  files: [],
  patch: "",
  truncated: false,
};

let restore: (() => void) | undefined;
let machine: Awaited<ReturnType<typeof attachMachine>> | undefined;

beforeEach(async () => {
  await seedUser(OWNER);
  await seedUser(OTHER);
  const database = db(env);
  await database.delete(schema.auditOutbox).run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE, userId: OWNER, name: "laptop", platform: "linux" })
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT,
      userId: OWNER,
      deviceId: DEVICE,
      name: "app",
      slug: "app",
      localPath: "/work/app",
    })
    .run();
});

afterEach(() => {
  restore?.();
  restore = undefined;
  machine?.close();
  machine = undefined;
});

function provider(handler: (asked: Asked) => Response | undefined | Promise<Response | undefined>) {
  const fake = fakeProvider(handler);
  restore = replaceOutbound(fake.fetcher);
  return fake;
}

const responses = (text: string) =>
  Response.json({ output: [{ type: "message", content: [{ type: "output_text", text }] }] });

const audits = () =>
  db(env).select().from(schema.auditOutbox).where(eq(schema.auditOutbox.userId, OWNER)).all();

const commitMessage = (body: unknown = {}, userId = OWNER, environment = aiOn()) =>
  call(`/api/projects/${PROJECT}/ai/commit-message`, { body, userId, env: environment });

describe("POST /api/projects/:id/ai/commit-message", () => {
  it.each(["default", "override"])(
    "requires an explicit API-key choice before replacing a retired plan %s",
    async (choice) => {
      machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
      await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test-key" });
      if (choice === "default") {
        await env.DB.prepare(
          "INSERT INTO ai_settings (user_id, default_provider) VALUES (?, 'chatgpt')",
        )
          .bind(OWNER)
          .run();
      } else {
        await env.DB.prepare(
          "INSERT INTO ai_operation_settings (user_id, operation, provider) VALUES (?, 'commit', 'chatgpt')",
        )
          .bind(OWNER)
          .run();
      }
      const fake = provider(() => responses("Add login"));
      const refused = await commitMessage();
      expect(refused.status).toBe(409);
      expect(fake.asked).toHaveLength(0);
      expect(machine.seen).toHaveLength(0);
      await call("/api/ai/settings", {
        method: "PUT",
        body: { operations: { commit: { instructions: "Keep the plan" } } },
        userId: OWNER,
        env: aiOn(),
      });
      expect((await commitMessage()).status).toBe(409);
      expect(fake.asked).toHaveLength(0);
      const explicit = await commitMessage({ provider: "openai" });
      expect(explicit.status).toBe(200);
      expect(fake.asked.map((asked) => asked.url)).toEqual(["https://api.openai.com/v1/responses"]);
    },
  );
  it("reads the staged changes, asks the provider, cleans the answer and audits the event", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test" });
    const fake = provider((asked) => {
      if (asked.url !== "https://api.openai.com/v1/responses") return undefined;
      expect(asked.headers.get("authorization")).toBe("Bearer sk-test");
      const body = asked.json() as {
        model: string;
        instructions: string;
        input: Array<{ content: Array<{ text: string }> }>;
        store: boolean;
      };
      expect(body.model).toBe("gpt-5.5");
      expect(body.store).toBe(false);
      expect(body.instructions).toContain("single git commit message");
      const user = body.input[0]?.content[0]?.text ?? "";
      expect(user).toContain("Branch: feature/login");
      expect(user).toContain("- src/login.ts (+12 -3)");
      expect(user).toContain("+export function login() {}");
      return responses("```\nAdd the login flow.\n\nUsers asked for it.\n```");
    });

    const response = await commitMessage();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Add the login flow\n\nUsers asked for it.",
      provider: "openai",
      model: "gpt-5.5",
    });
    expect(machine.seen).toEqual([{ action: "staged_context" }]);
    expect(fake.asked).toHaveLength(1);

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tool: "ai.commit_message",
      status: "ok",
      endpoint: "dashboard",
      projectId: PROJECT,
      clientName: "Exeora Dashboard",
    });
    // The event, and nothing of what was sent or answered.
    const record = JSON.stringify(rows[0]);
    expect(record).not.toContain("login()");
    expect(record).not.toContain("Users asked");
  });

  it("uses the operation's model and instructions from the settings", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test" });
    await writeSettings(env, OWNER, {
      operations: { commit: { model: "gpt-5.5-codex", instructions: "Mention the ticket." } },
    });
    provider((asked) => {
      const body = asked.json() as {
        model: string;
        input: Array<{ content: Array<{ text: string }> }>;
      };
      expect(body.model).toBe("gpt-5.5-codex");
      expect(body.input[0]?.content[0]?.text).toContain(
        "Additional user instructions:\nMention the ticket.",
      );
      return responses("Add login");
    });
    const response = await commitMessage();
    expect(await response.json()).toEqual({
      message: "Add login",
      provider: "openai",
      model: "gpt-5.5-codex",
    });
  });

  it("streams from the Codex backend for a ChatGPT link", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    await storeCredential(env, KEY, OWNER, "openai", "oauth", {
      access: "at_chatgpt",
      refresh: "rt",
      expiresAt: Date.now() + 3_600_000,
      accountId: "acct_1",
    });
    provider((asked) => {
      if (asked.url !== "https://chatgpt.com/backend-api/codex/responses") return undefined;
      expect(asked.headers.get("authorization")).toBe("Bearer at_chatgpt");
      expect(asked.headers.get("chatgpt-account-id")).toBe("acct_1");
      expect(asked.headers.get("originator")).toBe("codex_cli_rs");
      expect(asked.headers.get("openai-beta")).toBe("responses=experimental");
      expect(asked.json()).toMatchObject({ model: "gpt-5.5", stream: true, store: false });
      const stream = [
        'event: response.created\ndata: {"type":"response.created"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Add "}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"login."}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}\n\n',
      ].join("");
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const response = await commitMessage();
    expect(await response.json()).toEqual({
      message: "Add login",
      provider: "openai",
      model: "gpt-5.5",
    });
  });

  it("says when nothing is staged, without asking the provider", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => EMPTY);
    await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test" });
    const fake = provider(() => undefined);
    const response = await commitMessage();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "ai_nothing_to_summarize" });
    expect(fake.asked).toHaveLength(0);
    expect(await audits()).toMatchObject([{ status: "error", errorCode: "NOTHING_TO_SUMMARIZE" }]);
  });

  it("answers 409 when no provider is linked, and records nothing", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    provider(() => undefined);
    const response = await commitMessage();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ai_not_linked" });
    expect(machine.seen).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("answers 502 when the provider fails, and records the failure", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test" });
    provider(() => Response.json({ error: "overloaded" }, { status: 500 }));
    const response = await commitMessage();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "ai_unavailable" });
    expect(await audits()).toMatchObject([{ status: "error", errorCode: "AI_UNAVAILABLE" }]);
  });

  it("answers 409 when the provider no longer takes the credential", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => STAGED);
    await storeCredential(env, KEY, OWNER, "xai", "api_key", { access: "xai-revoked" });
    provider(() => Response.json({}, { status: 401 }));
    const response = await commitMessage({ provider: "xai" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ai_reconnect" });
  });

  it("fails while the machine is offline, after recording that it tried", async () => {
    await storeCredential(env, KEY, OWNER, "openai", "api_key", { access: "sk-test" });
    const fake = provider(() => undefined);
    const response = await commitMessage();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LOCAL_EXECUTOR_OFFLINE" });
    expect(fake.asked).toHaveLength(0);
    expect(await audits()).toMatchObject([{ tool: "ai.commit_message", status: "error" }]);
  });

  it("never generates for another account's project, and is off without the feature", async () => {
    provider(() => undefined);
    const other = await commitMessage({}, OTHER);
    expect(other.status).toBe(404);
    const off = await commitMessage({}, OWNER, aiOff());
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ error: "ai_disabled" });
  });
});

describe("POST /api/projects/:id/ai/pull-request", () => {
  it("reads the range over the base and splits the answer into title and body", async () => {
    machine = await attachMachine(OWNER, DEVICE, PROJECT, () => RANGE);
    await storeCredential(env, KEY, OWNER, "xai", "api_key", { access: "xai-key" });
    await writeSettings(env, OWNER, { defaultProvider: "xai" });
    const fake = provider((asked) => {
      // A deployment without the Responses endpoint: chat completions answer instead.
      if (asked.url === "https://api.x.ai/v1/responses") return Response.json({}, { status: 404 });
      if (asked.url !== "https://api.x.ai/v1/chat/completions") return undefined;
      const body = asked.json() as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe("grok-4-fast");
      expect(body.messages[0]?.content).toContain("pull request title and description");
      expect(body.messages[1]?.content).toContain("Base branch: main\nHead branch: feature/login");
      expect(body.messages[1]?.content).toContain("- def4567 Add login");
      return Response.json({
        choices: [{ message: { content: "Add the login flow.\n\nWhat changed and why." } }],
      });
    });
    const response = await call(`/api/projects/${PROJECT}/ai/pull-request`, {
      body: { base: "main" },
      userId: OWNER,
      env: aiOn(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: "Add the login flow",
      body: "What changed and why.",
      provider: "xai",
      model: "grok-4-fast",
    });
    expect(machine.seen).toEqual([{ action: "range_context", base: "main" }]);
    expect(fake.asked.map((asked) => asked.url)).toEqual([
      "https://api.x.ai/v1/responses",
      "https://api.x.ai/v1/chat/completions",
    ]);
    expect(await audits()).toMatchObject([{ tool: "ai.pull_request", status: "ok" }]);
  });

  it("requires a base", async () => {
    const response = await call(`/api/projects/${PROJECT}/ai/pull-request`, {
      body: {},
      userId: OWNER,
      env: aiOn(),
    });
    expect(response.status).toBe(400);
  });
});

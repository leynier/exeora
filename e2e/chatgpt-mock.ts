export const aiStatus = {
  enabled: true,
  providers: [
    {
      id: "openai",
      label: "OpenAI API",
      authKinds: ["api_key"],
      linked: { kind: "api_key", accountLabel: "ada@example.com" },
      models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
    },
    {
      id: "xai",
      label: "Grok",
      authKinds: ["oauth", "api_key"],
      linked: null,
      models: [{ id: "grok-4-fast", label: "Grok 4 Fast" }],
    },
    {
      id: "chatgpt",
      label: "ChatGPT plan",
      authKinds: [],
      machineBound: true,
      linked: null,
      models: [],
    },
  ],
  settings: {
    defaultProvider: "openai",
    operations: {
      commit: { provider: null, model: null, instructions: null },
      pull_request: { provider: null, model: null, instructions: null },
    },
  },
  oauthAvailable: true,
};

export type AiStatusFixture = {
  enabled: boolean;
  providers: {
    id: "openai" | "xai" | "chatgpt";
    label: string;
    authKinds: ("oauth" | "api_key")[];
    linked: {
      kind: "oauth" | "api_key";
      accountLabel: string | null;
      legacy?: boolean;
    } | null;
    machineBound?: boolean;
    models: { id: string; label: string }[];
  }[];
  settings: {
    defaultProvider: "openai" | "xai" | "chatgpt" | null;
    operations: {
      commit: {
        provider: "openai" | "xai" | "chatgpt" | null;
        model: string | null;
        instructions: string | null;
      };
      pull_request: {
        provider: "openai" | "xai" | "chatgpt" | null;
        model: string | null;
        instructions: string | null;
      };
    };
  };
  oauthAvailable: boolean;
};

export const chatgptOnlyAiStatus: AiStatusFixture = {
  enabled: true,
  providers: [
    {
      id: "chatgpt",
      label: "ChatGPT plan",
      authKinds: [],
      machineBound: true,
      linked: null,
      models: [],
    },
  ],
  settings: {
    defaultProvider: null,
    operations: {
      commit: { provider: null, model: null, instructions: null },
      pull_request: { provider: null, model: null, instructions: null },
    },
  },
  oauthAvailable: true,
};

export type ChatgptStatusFixture = {
  state:
    | "signed_out"
    | "pending"
    | "ready"
    | "plan_disabled"
    | "reconnect"
    | "client_invalid"
    | "unavailable_on_cloud";
  account?: {
    label: string | null;
    email: string | null;
    scopes: string[];
    planUsage: boolean;
    newRegistration: boolean;
    noticeId?: string;
  } | null;
  pending?: { expiresAt: number } | null;
  loginError?: string | null;
};

export type ChatgptLoginFixture = {
  authorizeUrl: string;
  expiresAt: number;
};

export type ChatgptModelsFixture = {
  models: { id: string; label: string }[];
};

export type ChatgptProjectStatusContext = {
  projectId: string;
  workspace: string | undefined;
  requestNumber: number;
};

export type ChatgptModelsContext = {
  deviceId: string;
  requestNumber: number;
};

export type ChatgptMock = {
  status?:
    | ChatgptStatusFixture
    | ((context: {
        deviceId: string;
        requestNumber: number;
        loginMode: string | undefined;
      }) => ChatgptStatusFixture);
  login?:
    | ChatgptLoginFixture
    | ((context: { deviceId: string; mode: string; requestNumber: number }) => ChatgptLoginFixture);
  /** Status resolved for the project/workspace that will run a generation. */
  projectStatus?:
    | ChatgptStatusFixture
    | ((context: ChatgptProjectStatusContext) => ChatgptStatusFixture);
  models?: ChatgptModelsFixture | ((context: ChatgptModelsContext) => ChatgptModelsFixture);
  logout?: { revocationConfirmed: boolean };
};

export const chatgptStatus: ChatgptStatusFixture = { state: "signed_out" };

export const chatgptLogin: ChatgptLoginFixture = {
  authorizeUrl:
    "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=e2e-state",
  expiresAt: Date.now() + 60_000,
};

export const chatgptReadyStatus: ChatgptStatusFixture = {
  state: "ready",
  account: {
    label: "ada@example.com",
    email: "ada@example.com",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    planUsage: true,
    newRegistration: false,
  },
};

# Exeora / MCP Code Gateway — Complete Conversation and Analysis

**Date:** August 5, 2026  
**Language:** English  
**Status:** Working document  
**Purpose:** Consolidate everything discussed about building a remote MCP service with local execution, including architecture, technology choices, product naming, security, deployment options, and monetization.

---

## 1. Starting Point: Open-Source Coding Agents Implemented in Python

The conversation began by looking for open-source coding agents implemented in Python.

The following projects were identified as relevant:

### mini-swe-agent

A minimal agent designed to work from the terminal or solve GitHub issues.

Notable characteristics:

- Very small and easy-to-study core.
- Approximately 100 lines for the main agent loop.
- Useful as a reference for understanding how a coding agent works.
- Easy to modify or use as the foundation for a custom implementation.
- MIT license.

It was considered a good option for studying how to build a small agent or how to transform its tools into MCP tools.

### OpenHands Software Agent SDK

This was considered probably the best Python option for reusing the tools of a coding agent.

The SDK separates components such as:

- Agent.
- Tool.
- Workspace.
- Terminal.
- File editor.
- Task tracking.
- Local, Docker, or Kubernetes execution.

Its main advantage is that it exposes tools as modular components, which would make it easier to wrap them as MCP tools.

### Aider

A terminal-based coding agent implemented in Python.

It includes:

- Code editing.
- Repository maps.
- Git integration.
- Command execution.
- Support for multiple providers and models.
- Apache 2.0 license.

The main disadvantage for this project is that its architecture is more tightly coupled to the complete product flow, chat behavior, edit formats, and Git workflow.

### Open SWE

An asynchronous LangChain agent implemented with LangGraph and Deep Agents.

It is more organization-oriented and can:

- Receive tasks from Slack, Linear, or GitHub.
- Execute work in sandboxes.
- Create pull requests automatically.

It was considered too complex for the narrower goal of exposing only programming tools through MCP.

### SWE-agent

A Python research agent focused on solving issues and modifying repositories.

Its maintainers currently recommend mini-swe-agent for most use cases.

### Initial Python Conclusion

Recommended order:

1. OpenHands Software Agent SDK.
2. mini-swe-agent.
3. Aider.

OpenHands was considered the closest match to a Python library that already contains reusable coding-agent tools.

---

## 2. Equivalent Search in TypeScript

The next step was to look for similar projects implemented in TypeScript.

### Pi Agent Harness / pi-mono

This was considered the best candidate for directly reusing tools.

Its monorepo separates:

- Runtime.
- Agent loop.
- Model providers.
- Coding agent.
- TUI.
- Tools.
- Sessions.

The SDK exports factories such as:

```ts
createReadTool()
createBashTool()
createEditTool()
createWriteTool()
createGrepTool()
createFindTool()
createLsTool()
createCodingTools()
```

It can also run headlessly through a JSON protocol over `stdin/stdout`.

It was considered especially suitable for creating an MCP server that exposes the tools of a coding agent.

A possible structure would be:

```text
MCP Server
├── read_file  → createReadTool()
├── write_file → createWriteTool()
├── edit_file  → createEditTool()
├── bash       → createBashTool()
├── grep       → createGrepTool()
├── find       → createFindTool()
└── list       → createLsTool()
```

### Cline

Implemented mainly in TypeScript.

It offers:

- CLI.
- VS Code extension.
- JetBrains plugin.
- Node.js SDK.
- Custom tools.
- MCP support.
- Terminal execution.
- File editing.
- Checkpoints.
- Skills.
- Multiple agents.

Its advantage is maturity as a coding agent.

Its disadvantage is that the core is large and its tools are more tightly integrated into Cline's full lifecycle.

### OpenCode

A terminal coding agent implemented mainly in TypeScript.

It includes an internal tool registry with tools such as:

- `bash`
- `read`
- `edit`
- `glob`
- `grep`
- `webfetch`
- `websearch`
- `task`
- `todowrite`
- `lsp`
- `skill`

It has a reasonable separation between:

- Server.
- Agent.
- Tools.
- Plugins.
- Clients.

Its SDK is more focused on controlling an OpenCode instance than importing every tool as an independent library.

### Qwen Code

A terminal coding agent implemented mainly in TypeScript.

It includes:

- File tools.
- Terminal tools.
- Search.
- Skills.
- Subagents.
- MCP.

Its TypeScript SDK allows:

- Running the agent programmatically.
- Selecting which core tools to register.
- Excluding tools.
- Intercepting authorization.
- Defining command and path rules.

It was considered a strong option, although the SDK was still described as experimental.

### Gemini CLI

A TypeScript monorepo with separation between:

- `packages/core`
- `packages/cli`
- `packages/sdk`

Its SDK includes:

- Agent loop.
- Tool execution.
- Session context.
- Custom tools.

It was not considered the best foundation for a new project because of uncertainty around future implementation and product direction changes.

### Roo Code and Kilo Code

Both are full coding agents implemented mainly in TypeScript.

They are useful references for:

- IDE integration.
- Specialized modes.
- Permission systems.
- MCP.
- CLI.
- SDKs.

However, their monorepos are large if the goal is only to extract tools.

### TypeScript Conclusion

Recommended order:

1. Pi Agent Harness.
2. Cline SDK.
3. OpenCode.
4. Qwen Code.
5. Gemini CLI.

Pi was considered the most direct candidate for converting coding-agent tools into MCP tools.

---

## 3. Initial Idea: FastMCP TypeScript Deployed on Vercel

The next idea was to use the TypeScript FastMCP SDK and deploy a remote MCP server on Vercel.

It was clarified that the TypeScript FastMCP package is a separate project from the Python FastMCP project.

The TypeScript project provides:

- `FastMCP` for Node.js, Bun, and traditional servers.
- `EdgeFastMCP` for Web API-based runtimes.
- Streamable HTTP.
- Stateless mode.
- Hono internally.
- Tools.
- Resources.
- Prompts.

### Conceptual Example with Next.js and Vercel

```ts
// app/api/mcp/route.ts

import { EdgeFastMCP } from "fastmcp/edge";
import { z } from "zod";

const server = new EdgeFastMCP({
  name: "coding-tools",
  version: "1.0.0",
  mcpPath: "/api/mcp",
});

server.addTool({
  name: "echo",
  description: "Returns the provided text",
  parameters: z.object({
    text: z.string(),
  }),
  execute: async ({ text }) => {
    return text;
  },
});

async function handler(request: Request): Promise<Response> {
  return server.fetch(request);
}

export const GET = handler;
export const POST = handler;

export const runtime = "edge";
export const dynamic = "force-dynamic";
```

Resulting endpoint:

```text
https://your-project.vercel.app/api/mcp
```

### Fundamental Limitation

The MCP endpoint can run on Vercel, but a full coding agent should not execute all of its tools directly inside an Edge Function.

`EdgeFastMCP` does not provide:

- `node:fs`.
- `child_process`.
- Shell.
- Local processes.
- A persistent repository.

Pi tools expect a real environment with a filesystem and processes.

### Initially Recommended Architecture with Vercel Sandbox

```text
FastMCP TypeScript
Vercel Function / Edge
        │
        ▼
@vercel/sandbox
        │
        ▼
Sandbox per user or workspace
        │
        ├── cloned repository
        ├── filesystem
        ├── git
        ├── shell
        └── tools
```

An MCP tool would delegate execution to a sandbox.

Conceptual example:

```ts
import { EdgeFastMCP } from "fastmcp/edge";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

const server = new EdgeFastMCP({
  name: "coding-tools",
  version: "1.0.0",
  mcpPath: "/api/mcp",
});

server.addTool({
  name: "run_command",
  description: "Runs a command inside the workspace sandbox",
  parameters: z.object({
    workspaceId: z.string(),
    command: z.string(),
    args: z.array(z.string()).default([]),
  }),
  execute: async ({ workspaceId, command, args }) => {
    const sandbox = await Sandbox.getOrCreate({
      name: `workspace-${workspaceId}`,
    });

    const result = await sandbox.runCommand({
      cmd: command,
      args,
    });

    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: await result.stdout(),
      stderr: await result.stderr(),
    });
  },
});
```

### Possible Prototype Using `/tmp`

A simpler prototype was also considered:

```text
1. Receive tools/call.
2. Clone the repository into /tmp.
3. Execute one operation.
4. Generate a diff.
5. Push a commit or return the patch.
6. End the Function.
```

Problems:

- Repeated repository clones.
- No durable session.
- Risk from command execution.
- Execution duration limits.
- Temporary storage.

---

## 4. Direction Change: Local Execution with a Remote Control Plane

The idea then evolved.

Instead of executing tools in Vercel or in a remote sandbox, the goal became:

- Run the CLI locally.
- Keep code and tools on the user's machine.
- Have a remote service with:
  - Login.
  - UI.
  - MCP OAuth.
  - Device management.
  - Project management.
- Allow an MCP client to connect to the remote service.
- Send instructions from the server to the authenticated local CLI.
- Execute tools locally.
- Return the result to the MCP client.

### General Architecture

```text
Claude / ChatGPT / Cursor / another MCP Host
                    │
                    │ MCP + OAuth
                    ▼
              Remote service
          Gateway / Control plane
                    │
                    │ Persistent connection
                    ▼
          Authenticated local CLI
                    │
             ┌──────┴──────┐
             │             │
        local tools     user repository
       read/edit/bash
```

### Essential Principle

The CLI should establish an outbound connection to the service.

This avoids:

- Opening local ports.
- Configuring tunnels.
- Publicly exposing the user's computer.
- NAT problems.
- Firewall problems.

The service acts as a relay and control plane.

---

## 5. Cloudflare as an Alternative to Vercel

Cloudflare was evaluated as the infrastructure for this service.

The conclusion was that Cloudflare fits this architecture better than Vercel because the application needs:

- Persistent connections.
- Real-time coordination.
- Stable identity per workspace or device.
- Routing between MCP clients and local executors.
- OAuth.
- UI.
- State.
- Online/offline presence.

### Proposed Cloudflare Architecture

```text
Claude / ChatGPT / Cursor / another MCP Host
                    │
                    │ Streamable HTTP + MCP OAuth
                    ▼
          https://service.dev/mcp
          Cloudflare Worker
                    │
                    ▼
        Workspace Durable Object
       userId + projectId + deviceId
                    │
                    │ Outbound WebSocket from CLI
                    ▼
          Authenticated local CLI
                    │
             ┌──────┴──────┐
             │             │
        local tools     user repository
       read/edit/bash
```

### Durable Objects

A Durable Object could be created per:

```text
userId:projectId
```

or:

```text
userId:deviceId:projectId
```

Responsibilities of the Durable Object:

- Maintain the CLI WebSocket.
- Know whether the executor is online.
- Receive MCP calls.
- Generate a `requestId`.
- Forward the call to the CLI.
- Wait for the response.
- Return the result.
- Handle timeouts.
- Handle disconnections.
- Handle cancellation.
- Coordinate multiple clients.

### Two Separate Authentication Flows

Two distinct flows were identified.

#### 1. OAuth for the MCP Client

Relationship:

```text
Claude / Cursor / ChatGPT → remote MCP server
```

Possible scopes:

```text
tools:read
tools:execute
projects:alera
```

The client discovers OAuth endpoints, opens the browser, and obtains an access token.

#### 2. Authentication for the Local CLI

Relationship:

```text
Local CLI → Cloudflare relay
```

Suggested flow:

```text
1. The CLI generates PKCE.
2. It opens the browser.
3. The user signs in.
4. The web application authorizes the machine.
5. It redirects to localhost.
6. The CLI exchanges the code.
7. It stores the refresh token in the system keychain.
8. It opens the WebSocket.
```

Suggested executor scopes:

```text
executor:connect
executor:heartbeat
executor:execute
```

MCP tokens and executor tokens should have separate audiences and permissions.

### Full Tool Execution Flow

Example:

```json
{
  "name": "read_file",
  "arguments": {
    "path": "src/main.rs"
  }
}
```

Execution path:

```text
1. The MCP host sends tools/call to /mcp.
2. The Worker validates the MCP token.
3. It extracts userId, projectId, and permissions.
4. It finds the Durable Object.
5. It verifies that the CLI is connected.
6. It generates requestId, expiresAt, and nonce.
7. It sends the request over WebSocket.
8. The CLI validates the project, path, and tool.
9. It executes the tool locally.
10. It returns a result or error.
11. The Durable Object resolves the pending request.
12. The Worker responds to the MCP host.
```

Suggested internal contract:

```ts
type ToolRequest = {
  type: "tool.call";
  requestId: string;
  projectId: string;
  tool: string;
  arguments: unknown;
  issuedAt: number;
  expiresAt: number;
};
```

Response:

```ts
type ToolResponse = {
  type: "tool.result";
  requestId: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};
```

### Using FastMCP

FastMCP could handle:

- Tool definitions.
- MCP endpoint exposure.
- Tools, prompts, and resources.

A tool would not directly execute `fs.readFile()`.

It would delegate to the Durable Object:

```ts
server.addTool({
  name: "read_file",
  description: "Read a file from the selected local workspace",
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path }, context) => {
    const identity = getMcpIdentity(context);

    return env.WORKSPACES
      .getByName(`${identity.userId}:${identity.projectId}`)
      .callTool({
        tool: "read_file",
        arguments: { path },
      });
  },
});
```

### Alternative to FastMCP

Another option is to use the official MCP SDK directly on Cloudflare and keep tool contracts in a separate library.

Suggested structure:

```text
packages/
├── tool-contracts/
│   ├── read-file.ts
│   ├── edit-file.ts
│   ├── bash.ts
│   └── grep.ts
├── cloud-gateway/
│   ├── mcp.ts
│   ├── oauth.ts
│   ├── relay-do.ts
│   └── dashboard.ts
└── local-cli/
    ├── login.ts
    ├── connection.ts
    ├── executor.ts
    └── tools/
```

### Suggested Cloudflare Services

| Service | Responsibility |
|---|---|
| Workers | MCP, OAuth, API, and UI |
| Durable Objects | WebSockets and coordination |
| D1 | Users, projects, devices, and audit data |
| Workers KV | OAuth state and caching |
| R2 | Large logs, diffs, and artifacts |
| Static Assets | Web dashboard |
| Queues | Telemetry and asynchronous audit processing |

### Do Not Use Queues for Active Tool Calls

Normal tool calls should not be placed in a queue by default.

Reason:

A command could execute hours later after a disconnected machine reconnects, which may be dangerous.

If the executor is offline, the service should return:

```text
LOCAL_EXECUTOR_OFFLINE
```

Deferred execution could exist later as an explicit feature for safe operations only.

### Proposed UI

The interface could show:

```text
Devices
┌────────────────┬──────────┬─────────────────────┐
│ Machine        │ Status   │ Last seen           │
├────────────────┼──────────┼─────────────────────┤
│ ley-linux      │ Online   │ Now                 │
│ macbook        │ Offline  │ 2 hours ago         │
└────────────────┴──────────┴─────────────────────┘
```

```text
Projects
┌──────────┬─────────────┬────────────────────────┐
│ Project  │ Executor    │ Local path             │
├──────────┼─────────────┼────────────────────────┤
│ alera    │ ley-linux   │ /home/leynier/alera    │
└──────────┴─────────────┴────────────────────────┘
```

Possible UI capabilities:

- Revoke a machine.
- Change the default executor.
- Restrict tools per project.
- View recent tool calls.
- Require confirmation.
- Manage MCP clients.
- Revoke tokens.
- Configure allowed roots.
- Configure command policies.

### Local Security

The final authorization decision should happen in the CLI.

Example:

```toml
[project.alera]
path = "/home/leynier/Projects/alera"

allowed_tools = [
  "read_file",
  "list_files",
  "grep",
  "edit_file",
  "run_command",
]

[project.alera.commands]
allow = [
  "git *",
  "cargo *",
  "flutter *",
  "bun *",
]

deny = [
  "sudo *",
  "rm -rf /*",
  "shutdown *",
]
```

Approval modes:

```text
approval = "always"
approval = "dangerous-only"
approval = "never"
```

Local restrictions must always override remote configuration.

### Long-Running Commands

For short operations:

```text
run_command
```

For long-running processes:

```text
start_command
get_command_output
send_command_input
kill_command
```

This allows support for:

- Long test suites.
- Builds.
- Development servers.
- Interactive processes.

### Cloudflare Compared with Vercel

Cloudflare was considered a better fit because Durable Objects provide:

- Stable identity.
- Local state.
- Deterministic routing.
- WebSockets.
- Persistence.
- Hibernation.
- Coordination.

Recommended split:

```text
Cloudflare:
- MCP gateway
- OAuth
- WebSocket relay
- presence state
- UI
- API

Local machine:
- repository
- shell
- filesystem
- Git
- tools
```

### Recommended Technical MVP

```text
1. CLI login with browser + PKCE.
2. Device registration.
3. One active project per device.
4. CLI WebSocket connected to a Durable Object.
5. Remote MCP endpoint with OAuth.
6. Three tools:
   - read_file
   - edit_file
   - run_command
7. Dashboard with status, revocation, and logs.
```

---

## 6. Product Naming Exploration

The initial descriptive names were:

- `mcp-code-host`
- `mcp-code-gateway`

The conclusion was that these are good technical names for a repository or internal component, but not necessarily strong commercial brands.

### Naming Criteria

The commercial name should:

- Be short.
- Be easy to pronounce in English and Spanish.
- Be easy to spell after hearing it.
- Not depend entirely on “MCP”.
- Not be limited to coding agents.
- Be able to expand into agents, runtimes, CLIs, and other protocols.
- Support a family of product names.
- Be reasonably distinctive.

---

## 7. RunTether

**RunTether** was proposed.

Interpretation:

```text
run + tether
```

Concept:

> Local execution securely connected to a remote service.

Examples:

```bash
runtether login
runtether connect
runtether project add .
runtether status
```

Product family:

```text
RunTether
├── RunTether CLI
├── RunTether Cloud
├── RunTether Gateway
└── RunTether Dashboard
```

Possible taglines:

- Securely connect AI agents to your local development environment.
- Your local tools, available to any authorized agent.
- Run locally. Connect securely.

The domain `runtether.com` already exists, reducing its attractiveness.

---

## 8. Exeora

**Exeora** was proposed as an invented name.

Conceptual origin:

- `Exe-` from execute, execution, or `.exe`.
- `-ora` as a soft, memorable suffix.

Brand interpretation:

```text
Exeora = execution layer for agents
```

Approximate pronunciation:

- English: `ek-see-OR-ah`.
- Spanish: `ek-se-ó-ra`.

Product family:

```text
Exeora
Exeora CLI
Exeora Cloud
Exeora Connect
Exeora Gateway
Exeora Runtime
```

Possible taglines:

- Secure local execution for AI agents.
- Connect AI agents to your local tools.
- The local execution layer for AI agents.

Advantages:

- Invented brand.
- Broad enough to expand.
- Not tied to MCP.
- Sounds like a company or platform.
- Supports future product extensions.

Disadvantage:

- It does not immediately explain the product.
- It requires a descriptor or tagline.

---

## 9. ExeHost

**ExeHost** was evaluated.

Advantages:

- Communicates execution + host.
- Easy to write.
- Works well as a CLI name.
- Describes the local process reasonably well.

Example:

```bash
exehost login
exehost connect
exehost project add .
exehost status
```

Problems:

- It may imply that code is hosted remotely.
- “Host” may weaken the local-first positioning.
- `exe` strongly evokes Windows executables.
- The term already appears in other technical contexts.
- The exact domain is not freely available.

Conclusion:

- Weaker as the primary commercial brand.
- Strong as the name of the local daemon or executor.

Suggested brand architecture:

```text
Exeora
├── Exeora Cloud
├── Exeora Gateway
├── ExeHost
└── Exeora CLI
```

Phrase:

> Exeora connects agents to ExeHost, the secure local execution runtime.

---

## 10. Names in the Exeora Family

Several similar names were generated:

- Exevara.
- Exyora.
- Exevra.
- Exelra.
- Exevaro.
- Exenra.
- Exeory.
- Exeya.

Favorites:

1. Exeora.
2. Exevara.
3. Exevra.
4. Exevaro.

### Exevara

Interpretation:

```text
execution infrastructure for AI agents
```

Family:

```text
Exevara
├── Exevara Cloud
├── Exevara CLI
├── Exevara Gateway
├── Exevara Runtime
└── Exevara Connect
```

### Exevra

More technical and compact.

Family:

```text
Exevra CLI
Exevra Cloud
Exevra Relay
Exevra Runtime
```

### Exyora

Very close to Exeora visually, but harder to spell correctly after hearing it.

---

## 11. Alternatives Without Requiring “Exe”

The naming space was expanded beyond `Exe-`.

Suggestions included:

- Relvyn.
- Orynt.
- Kyntra.
- Vaylo.
- Rovyn.
- Alynt.
- Teryn.
- Rendra.
- Varelo.
- Oryvia.
- Narevo.
- Elvoro.
- Rovela.
- Averyn.
- Telyra.
- Virelo.
- Lunavo.
- Olyven.
- Valeno.
- Norelo.
- Velryn.
- Torvyn.
- Relynt.
- Nexryn.
- Kordra.
- Renvra.

Highlighted candidates:

### Relvyn

Interpretation:

```text
relay + link
```

Aligned with the architecture: a relay between remote agents and a local runtime.

### Orynt

Conceptual interpretation:

```text
origin + runtime
```

A strong, developer-oriented name.

### Kyntra

Interpretation:

```text
kinetic + transfer
```

Suggests movement and connection.

### Alynt

Interpretation:

```text
agent + link
```

Conceptually aligned with agent connectivity.

### Teryn

Interpretation:

```text
tether + run
```

A more brandable indirect alternative to RunTether.

---

## 12. Additional Constraint: Do Not Use the Letter “Y”

A later requirement was to avoid the letter `y`.

Names proposed without `y`:

### More Commercial

- Exevara.
- Orelva.
- Ruvora.
- Ravexa.
- Tervora.
- Nexavo.
- Rovara.
- Vorela.
- Torava.
- Lumeva.
- Orelvo.
- Navexa.

### More Technical

- Relvon.
- Torvex.
- Relvex.
- Lorvex.
- Exelvo.
- Exevo.
- Orvexa.
- Veltra.
- Kordra.
- Runelo.
- Tervon.
- Ruvano.

Favorites from that round:

1. Exeora.
2. Relvon.
3. Nexavo.

### Relvon

Suggests relay, connection, and linkage.

### Nexavo

Evokes nexus and connectivity.

### Tervora

Sounds like solid infrastructure.

### Ruvora

Suggests runtime without describing it literally.

---

## 13. Commercial Positioning

The product should not primarily be marketed as:

> “MCP hosting”

Instead, it should be positioned as:

> The secure local execution layer for AI agents.

Core value proposition:

> Connect any AI agent to your local development environment securely, without exposing ports, uploading your code, or managing tunnels.

Primary benefits:

- Source code remains local.
- No ports need to be opened.
- No VPN is required.
- No manual tunnel is required.
- The MCP client uses a standard remote URL.
- The user controls permissions locally.
- The service handles OAuth, relay, identity, and auditability.

---

## 14. Monetization Model

The main economic advantage is that heavy execution happens on the user's machine.

The service sells:

- Control plane.
- OAuth.
- Relay.
- UI.
- Device management.
- Project management.
- Policies.
- Audit logs.
- Security.
- Ease of use.

It does not primarily sell compute.

### Free Plan

Purpose:

- Individual adoption.
- Personal projects.
- Open source.

Suggested offering:

- 1 user.
- 1 simultaneously connected device.
- 3 projects.
- A reasonable number of MCP clients.
- Basic tools.
- Local confirmations.
- 24-hour history.
- Fair-use limits.

### Pro Plan

Suggested price:

```text
$10 per month
$96 per year
```

Features:

- 5 or 10 devices.
- Unlimited projects.
- Multiple online devices.
- Multiple simultaneous MCP connections.
- Project-specific policies.
- Command allowlists and denylists.
- 30-day history.
- Encrypted secrets.
- Persistent processes.
- Remote approvals.
- Optional custom endpoints.

Name:

```text
Exeora Pro
```

### Team Plan

Suggested price:

```text
$16 per user per month
$13 per user per month billed annually
```

Features:

- Organizations.
- Shared projects.
- Managed devices.
- Roles.
- Permissions.
- Enforced policies.
- 90-day audit history.
- Centralized revocation.
- GitHub integration.
- Executor assignment.
- Metrics.
- Webhooks.
- Log export.

Example policies:

```text
Developers:
- read_file
- grep
- run tests
- edit source files

Production:
- read-only
- no arbitrary shell
- approval required

Administrators:
- all tools
```

The recommendation was to charge per user, not per device.

### Enterprise Plan

Custom pricing.

Possible features:

- SAML.
- OIDC.
- SCIM.
- Device posture.
- Device attestation.
- SIEM integration.
- Configurable retention.
- Data residency.
- SLA.
- Priority support.
- Dedicated control plane.
- BYOC.
- Self-hosted deployment.
- Custom domains.
- Advanced organization policies.
- Signed binaries.
- Security reviews.

Potential contract range:

```text
$10,000–$50,000+ per year
```

depending on company size, support, and deployment model.

---

## 15. What to Charge For and What Not to Charge For

### Charge Primarily For

- Users.
- Governance and security.
- Audit-log retention.
- Integrations.
- High availability.
- Support.
- Optional cloud runtime.
- Dedicated control plane.
- BYOC.
- Enterprise features.

### Do Not Charge Primarily For

- Each file read.
- Each tool call.
- Each command.
- Model tokens.
- Number of personal devices.

Reason:

An agent may perform hundreds of tool calls for a single task. Charging per call would make bills unpredictable and discourage usage.

---

## 16. Cloud Runtime as an Additional Product

A future offering could provide:

```text
Local execution
Included with the subscription

Cloud execution
Usage-based
```

Use case:

When the local computer is offline:

> Run this task in an Exeora Cloud Sandbox.

Possible billing dimensions:

- CPU.
- Memory.
- Storage.
- Duration.
- Concurrency.

Options:

- Resell infrastructure with a margin.
- Support BYOC.
- Charge only for the orchestration and management layer.

Example:

```text
Actual sandbox cost: $1.00
Customer price:      $1.25–$1.40
```

---

## 17. Open-Source Strategy

Suggested open-source components:

- CLI.
- Local executor.
- Tool schemas.
- Relay-to-executor protocol.
- Tool SDK.
- Basic integrations.

Suggested commercial components:

- Managed OAuth.
- Dashboard.
- Global relay.
- Organization management.
- Audit logs.
- Policies.
- SSO and SCIM.
- Notifications.
- High availability.
- Support.

Possible structure:

```text
Exeora Community
Self-hosted, open source

Exeora Cloud
Hosted and managed

Exeora Enterprise
Dedicated or BYOC
```

Advantages:

- Trust.
- Auditable local execution code.
- Developer-first adoption.
- Monetization through the managed service.

---

## 18. Features Most Likely to Drive Paid Conversion

1. Multiple machines and projects.
2. Remote approvals.
3. Persistent policies.
4. Understandable audit logs.
5. Teams and organizations.
6. Alternate executors.
7. Cloud runtime when the local machine is offline.
8. GitHub organization integration.
9. SSO.
10. SCIM.
11. Slack integration.
12. SIEM integration.
13. Log export.
14. Centralized revocation.
15. Device management.

---

## 19. Monetizable MVP

### Free

```text
- 1 device
- 3 projects
- 24-hour history
```

### Pro

```text
- 5 devices
- unlimited projects
- 30-day history
- custom policies
- remote approvals
- persistent processes
```

### Later Team Plan

```text
- organizations
- RBAC
- shared projects
- audit logs
- centralized policies
```

---

## 20. Consolidated Product Definition

### What It Is

A remote MCP gateway that connects AI-agent clients to programming tools and development environments that remain on the user's local machine.

### What Runs in the Cloud

- OAuth.
- Authentication.
- Authorization.
- Routing.
- Relay.
- UI.
- Presence.
- Audit logging.
- Policies.
- Device management.
- Project management.

### What Runs Locally

- Filesystem.
- Shell.
- Git.
- Tests.
- Builds.
- Linters.
- Compilers.
- Coding tools.
- Interactive processes.

### Differentiators

- The repository is not uploaded.
- No local ports are opened.
- No tunnels are required.
- No VPN is required.
- Compatible with MCP clients.
- Simple CLI login.
- Local permission control.
- Local-first architecture.
- Can work with any compatible agent.

### Short Description

> Secure local execution for AI agents.

### Extended Description

> Connect any AI agent to your local development environment securely, without exposing ports, uploading your source code, or manually managing tunnels.

---

## 21. Recommended Working Name

The strongest working name throughout the conversation was:

# Exeora

Possible product architecture:

```text
Exeora
├── Exeora Cloud
├── Exeora Gateway
├── Exeora CLI
├── ExeHost
├── Exeora Runtime
└── Exeora Enterprise
```

Descriptor:

> A secure local execution layer for AI agents.

Technical repository name:

```text
mcp-code-gateway
```

or:

```text
mcp-code-host
```

Commercial brand:

```text
Exeora
```

Local daemon name:

```text
ExeHost
```

---

## 22. Suggested Next Steps

### Product

1. Confirm the product name.
2. Check domains.
3. Check trademarks.
4. Define the initial audience.
5. Define Free and Pro plans.
6. Design onboarding.

### Architecture

1. MCP Worker.
2. MCP OAuth.
3. CLI login with PKCE.
4. Device registration.
5. Durable Object per workspace.
6. Persistent WebSocket.
7. Tool-call protocol.
8. Local executor.
9. Local policies.
10. Device and project dashboard.

### MVP

Initial tools:

```text
read_file
edit_file
run_command
```

CLI commands:

```bash
exeora login
exeora device register
exeora project add .
exeora connect
exeora status
exeora logout
```

Initial user flow:

```text
1. Install the CLI.
2. Run exeora login.
3. Authorize in the browser.
4. Register a local project.
5. Keep the executor connection active.
6. Add the remote MCP URL to a client.
7. Authorize access.
8. Execute tools locally.
```

---

## 23. Executive Summary

The final idea is to build a local-first SaaS service that connects any MCP client to programming tools executed on a user's local machine.

Cloudflare would act as the control plane:

- Workers.
- OAuth.
- Durable Objects.
- D1.
- R2.
- UI.
- Relay.

The local CLI would act as the execution plane:

- Filesystem.
- Shell.
- Git.
- Tools.
- Policies.
- Confirmations.
- Processes.

The strongest working commercial name is **Exeora**.

The recommended business model is:

| Plan | Initial Price |
|---|---:|
| Free | $0 |
| Pro | $10/month |
| Team | $16/user/month |
| Enterprise | Custom |
| Cloud Runtime | Usage-based |

The core value proposition is:

> **Run locally. Connect securely. Use from any AI agent.**

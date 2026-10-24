import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CloudCliConfig } from "../packages/protocol/src/cloud.js";
import * as limits from "../packages/protocol/src/limits.js";
import {
  ExecutorMessage,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  RelayMessage,
} from "../packages/protocol/src/messages.js";
import { CommandPolicy, LocalCommandPolicy } from "../packages/protocol/src/policy.js";
import { agentPrompt } from "../packages/protocol/src/prompt.js";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "../packages/protocol/src/tools.js";
import { rustJsonSchema } from "./rust-json-schema.js";

const root = join(import.meta.dirname, "..");
const protocolDir = join(root, "crates/exeora-cli/protocol");

const contract = {
  protocolVersion: PROTOCOL_VERSION,
  minSupportedProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  toolNames: TOOL_NAMES,
  limits,
  prompts: {
    project: agentPrompt({ account: false }),
    account: agentPrompt({ account: true }),
  },
  schemas: {
    executorMessage: rustJsonSchema(ExecutorMessage),
    relayMessage: rustJsonSchema(RelayMessage),
    commandPolicy: rustJsonSchema(CommandPolicy),
    localCommandPolicy: rustJsonSchema(LocalCommandPolicy),
    cloudCliConfig: rustJsonSchema(CloudCliConfig),
    tools: Object.fromEntries(
      TOOL_NAMES.map((name) => [
        name,
        {
          input: rustJsonSchema(TOOL_DEFINITIONS[name].inputSchema),
          output: rustJsonSchema(TOOL_DEFINITIONS[name].outputSchema),
          readOnly: TOOL_DEFINITIONS[name].readOnly,
        },
      ]),
    ),
  },
};

const typeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ExeoraProtocolTypes",
  type: "object",
  properties: {
    executorMessage: rustJsonSchema(ExecutorMessage),
    relayMessage: rustJsonSchema(RelayMessage),
    commandPolicy: rustJsonSchema(CommandPolicy),
    localCommandPolicy: rustJsonSchema(LocalCommandPolicy),
    cloudCliConfig: rustJsonSchema(CloudCliConfig),
  },
  required: [
    "executorMessage",
    "relayMessage",
    "commandPolicy",
    "localCommandPolicy",
    "cloudCliConfig",
  ],
  additionalProperties: false,
};

await mkdir(protocolDir, { recursive: true });
for (const [name, value] of [
  ["contract.json", contract],
  ["types.schema.json", typeSchema],
] as const) {
  const path = join(protocolDir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

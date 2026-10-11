# Private experimental combined example

`bun run plugin:build:experimental` creates one representative mixed-root fixture under `.artifacts/experimental-plugin/<version>/exeora-combined-experimental.zip`, its SHA-256 sidecar and local metadata. It is explicitly experimental, is ignored by Git, and is never invoked by landing/deploy/release builds. There is no public download link or route. The five maintained production packages remain separate and unchanged by its build.

The example shares three portable Exeora skills and standard root MCP. Its root Agent Plugins 1.0.0 manifest also includes the existing OpenAI namespace; Copilot uses these standard root components. A Claude manifest/`.mcp.json` and a Cursor manifest/native `cursor.mcp.json` coexist to exercise selection conflicts. This is not the pure Agent Plugin distribution. No Copilot image extension, Kiro implementation or additional provider is added.

## Verified package and parser evidence

The build validates root manifest/MCP against official schemas and each input distribution before selecting its resources. The first reviewed example has 13 files, 23,647 bytes, SHA-256 `bdaf3e4aee45cfd3cbf570fae17688146aca14451aa60ba4ed74fc2814befb31`. It was sent once to the verified existing private Telegram target under the user's explicit delivery instruction on 2026-10-11 at 03:45:22 UTC. The receipt and destination evidence stay local; no credentials, chat IDs or account state are committed.

Claude Code 2.1.296 strict validation accepted the extracted mixed folder. Cursor's official template validator accepted its Cursor manifest through a temporary marketplace wrapper, with an optional hooks warning. These checks do not establish acceptance in Claude web or actual Cursor marker selection. Subsequently the user reported preliminary import/use success in Claude web for one of three experimental ZIPs, without identifying which. This is user-reported evidence, not an OAuth verification or acceptance of all ZIPs. The earlier prediction that alternate manifests necessarily cause web rejection was unsupported and is withdrawn.

Copilot CLI 1.0.95 `--plugin-dir <temporary-folder> plugin list --json` selected a deliberately distinct root metadata name ahead of the alternate Claude name. It also listed copies with an unsupported root schema and an unknown root field. Thus this read-only command proves metadata selection/listing only; it does not prove schema rejection or runtime component loading. Temporary configuration directories were removed; no actual installation, skill execution, MCP call or OAuth exchange was performed.

## Limits by client

| Client | Limit of this combined fixture |
| --- | --- |
| Agent Plugins core | Root JSON conforms to 1.0.0, including a permitted provider extension. Unsupported namespaces should be ignored. Extra provider manifests are not portable components; client loading remains unverified. |
| ChatGPT | [Imported MCP declarations are Desktop only](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins), including remote HTTPS. Both this actual sent ZIP and the separate OpenAI ZIP declare root MCP. See [public web distribution](chatgpt-plugin-distribution.md); removing MCP or adding private app IDs would not meet the public-use goal. |
| Claude web | The [API requirements](https://platform.claude.com/docs/en/manage-claude/plugins-api) describe one Claude manifest. This does not establish rejection of all alternate provider manifests in the web importer. Preliminary user success has been reported for an unidentified ZIP; this specific fixture and real OAuth remain unverified. Use the separate Claude package for production. |
| Cursor / Grok Bot | Cursor's reference describes both markers but not mixed-marker priority. The native manifest points to its own MCP file. Grok Bot's guide does not document arbitrary ZIP/repository ingestion. Real installation/availability remain unverified. |
| GitHub Copilot | The [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) specifies root Agent Plugins priority over legacy alternate manifests. The local inventory check is consistent with selection only; full CLI loading and app/VS Code acceptance remain separate checks. |

No structural validator establishes universal compatibility, real host installation or OAuth. The [standard](https://agent-plugins.org/specification) defines component discovery and extension isolation; it does not prescribe archive upload policy. Separate distribution allowlists reject additional resources for release hygiene, which is not an observation of a client rejecting them. Credential-free MCP validation and archive allowlists prevent secrets or executable runtime files from entering this example.

The sent v1 artifact remains at `.artifacts/experimental-plugin/exeora-combined-experimental.zip` with the recorded hash. Version `0.0.0-experimental.2` corrects documentation only and writes to its own directory when explicitly built. It does not remove ChatGPT’s imported-MCP restriction and has not been sent. There is no speculative replacement delivery.

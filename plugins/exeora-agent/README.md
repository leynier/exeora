# Agent Plugin

Exeora's pure Agent Plugins 1.0.0 distribution contains root `plugin.json`, root `mcp.json`, and three portable Agent Skills. It has no provider extensions, provider directories, listing icons or client-specific configuration. The website channel is named **Agent Plugin**; the standard package identifier is `exeora-agent-plugin` because names cannot contain capitals or spaces.

## Install in a compatible client

1. Download `exeora-agent-plugin.zip` from https://exeora.dev/docs/agent-plugin/ and verify its SHA-256 sidecar.
2. Follow the client's documented Agent Plugins 1.0.0 import or directory-loading workflow. If it requires a directory, extract the archive into one dedicated folder; `plugin.json` must be at that folder's root. The standard does not prescribe a ZIP upload, marketplace, installation directory or UI.
3. Confirm that the client discovers the three skills and supports the declared Streamable HTTP MCP transport. Support for skills alone does not establish remote MCP support.
4. Use the client's own MCP connection and authorization flow for `https://exeora.dev/mcp`. The standard defines no portable OAuth or credential-reference fields. Never paste tokens or passwords into chat or edit this archive to include them.
5. Ask the client to list authorized Exeora projects. Only a successful real tool response verifies access; installing or schema-validating a package does not.

The skills operate on Exeora's selected remote projects and workspaces. Keep routing selectors on each call, preserve existing changes, follow project instructions and policy, and perform only work the user authorized. Do not expand account grants or persistent tool approvals during setup.

## Interoperability limits

Agent Plugins 1.0.0 standardizes package discovery and two component types, not a shared account, OAuth session, interactive app, marketplace listing or every client's native format. A client may load skills without MCP support; an MCP-capable client need only support one of stdio and Streamable HTTP. This package needs the latter and a client that can complete Exeora authentication. Client-specific features and interfaces are not included.

The builder validates both JSON documents against the official 2020-12 schemas plus stricter Exeora distribution constraints. Source is at https://github.com/leynier/exeora/tree/main/plugins/exeora-agent; license is AGPL-3.0-only. No client installation or real OAuth is claimed by the package tests.

Specification: https://agent-plugins.org/specification
Schemas: https://agent-plugins.org/schemas

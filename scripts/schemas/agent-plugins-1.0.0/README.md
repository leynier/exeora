# Official Agent Plugins 1.0.0 schemas

Downloaded from the canonical [manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) on 2026-10-11 UTC. These are the official Draft 2020-12 documents, with repository formatting only. They are development/build inputs and are not bundled in plugin ZIPs. Agent Plugins documentation and schema provenance: https://agent-plugins.org/schemas.

Ajv 8.20.0 validates the standard packages offline during the build. `scripts/plugin-distributions.test.ts` pins their SHA-256 digests over compact JSON serialization so formatting does not affect provenance. The normative specification governs additional semantics; Exeora adds narrower distribution constraints for its public endpoint and the pure package. Update copies and their reviewed digests together only after checking an official version change.

- plugin.schema.json semantic SHA-256: `d9a49839afcbce02858fe55ac64a844b002a9a588e9db1b31ebd72256bc61b8d`
- mcp.schema.json semantic SHA-256: `fc7a2a253ba117726bfdca51229ca98d103b4616c5f25c5a941563c0493faeeb`

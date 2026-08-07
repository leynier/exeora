# Security

## Reporting a vulnerability

Email **hello@exeora.dev**. Do not open a public GitHub issue for anything that could be used to run commands, escalate access, or reach another account.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The component involved (gateway, CLI, dashboard, docs), if known
- Whether you are reporting against [exeora.dev](https://exeora.dev) or a self-hosted install

You should receive an acknowledgement within a few days. We will keep you informed of progress and credit you if you want it once a fix is out, unless you prefer to stay anonymous.

## Scope

In scope:

- Authentication and authorization (OAuth, sessions, project isolation, admin panel)
- The MCP and relay paths that can cause a connected machine to run tools
- Path confinement, command policy, and approval flows
- Secrets handling in the CLI and the Worker
- Cross-tenant data exposure

Out of scope:

- Denial of service against public endpoints
- Issues that require an already-compromised machine running the CLI
- Social engineering of individual account holders
- Vulnerabilities in third-party MCP clients

## Self-hosted installs

If you run your own gateway, patch promptly when a fix is released. The first account to register on a fresh database becomes the administrator unless `ADMIN_EMAILS` is set; protect that first sign-in the same way you would protect any root account.

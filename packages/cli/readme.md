# exeora

Secure execution for AI agents, on any machine.

Connect any MCP client (Claude, ChatGPT, Cursor, VS Code, Claude Code) to the development environment on any machine you can run a command on: a server, a VM, a build box, a Raspberry Pi, or your own laptop. No port to open, no source code to upload, no tunnel to wire up.

The CLI dials **out** to the gateway and holds the connection open. Nothing ever dials in, which is why the same command works on a laptop behind NAT and on a box behind a corporate firewall, with no configuration on either.

## Install

```bash
npm install -g exeora
```

Requires Node 22 or newer. `npx exeora` works too, though `connect` is meant to be left running, so a global install is usually what you want.

## Use

```bash
exeora login             # opens the browser
exeora device register   # registers this machine
exeora project add .     # prints the MCP URL for this directory
exeora connect           # leave this running
```

Then point a client at the printed URL:

```bash
claude mcp add --transport http exeora <the URL>
```

| Command | What it does |
|---|---|
| `login` / `logout` | Sign in through the browser, or forget the session on this machine |
| `device register` | Register this machine so it can serve tool calls |
| `device list` | List your machines and whether they are online |
| `project add [path]` | Register a directory as a project and print its MCP URL |
| `project list` / `project remove <slug>` | Manage this machine's projects |
| `connect` | Serve tool calls until you stop it |
| `status` | Show registration, gateway and projects |

## Tools an agent can run

`read_file` · `list_files` · `grep` · `edit_file` · `write_file` · `run_command`

Every path is resolved and confined to the project root before anything touches the disk.

**Commands are not filtered in this release, and there is no approval step.** An agent connected to a project can run anything inside that directory on whichever machine is serving it. Connect projects you are comfortable letting an agent change, and revoke a machine from the dashboard at <https://exeora.dev> the moment you want it to stop.

## Where things are stored

The refresh token goes to the OS keychain. Machines with no secret service, which is most Linux servers and CI containers, get a `0600` file under `$XDG_CONFIG_HOME/exeora/` instead, and the CLI says so when it happens. Everything else (gateway, device, projects) is plain JSON; `exeora status` prints the path.

`EXEORA_GATEWAY_URL` points the CLI at a different gateway, which is only useful when working on Exeora itself. It wins over the stored value without overwriting it.

MIT licensed. <https://exeora.dev>

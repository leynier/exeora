# @exeora/cli

Secure execution for AI agents, on any machine.

Connect any MCP client (Claude, ChatGPT, Cursor, VS Code, Claude Code) to the development environment on any machine you can run a command on: a server, a VM, a build box, a Raspberry Pi, or your own laptop. No port to open, no source code to upload, no tunnel to wire up.

The CLI dials **out** to the gateway and holds the connection open. Nothing ever dials in, which is why the same command works on a laptop behind NAT and on a box behind a corporate firewall, with no configuration on either.

## Use

```bash
cd the-project-you-want-to-serve
npx @exeora/cli connect
```

That is the whole thing. `connect` opens the browser to sign in if you are not signed in, registers the machine if it is not registered, and registers the directory if it is not a project yet. Each step is skipped when it is already done, so running it again just connects.

It prints an MCP URL. Point a client at it:

```bash
claude mcp add --transport http exeora <the URL>
```

Leave `connect` running: nothing is served while it is not.

Requires Node 22 or newer. To keep the binary on your PATH instead of going through `npx`:

```bash
npm install -g @exeora/cli
exeora connect
```

| Command | What it does |
|---|---|
| `connect [path]` | Sign in, register and serve, skipping whatever is already done |
| `login` / `logout` | Sign in through the browser, or forget the session on this machine |
| `device register` / `device list` | Register this machine by hand, or list your machines |
| `project add [path]` | Register a directory without connecting |
| `project list` / `project remove <slug>` | Manage this machine's projects |
| `status` | Show registration, gateway and projects |

Everything below `connect` in that table is what `connect` does for you. They stay because a script sometimes wants one step without the others.

`connect` takes a few flags for the cases it cannot guess: `--slug` to name the project in its URL, `--name` to name the machine, `--no-add` to serve what is already registered without adding this directory, and `--reset` to register the machine again after revoking it from the dashboard.

It refuses to register your home directory or the filesystem root. A project is the boundary every tool is confined to, so those two would hand over the whole machine.

## Tools an agent can run

`read_file` · `list_files` · `grep` · `edit_file` · `write_file` · `run_command`

Every path is resolved and confined to the project root before anything touches the disk.

**Commands are not filtered in this release, and there is no approval step.** An agent connected to a project can run anything inside that directory on whichever machine is serving it. Connect projects you are comfortable letting an agent change, and revoke a machine from the dashboard at <https://exeora.dev> the moment you want it to stop.

## Where things are stored

The refresh token goes to the OS keychain. Machines with no secret service, which is most Linux servers and CI containers, get a `0600` file under `$XDG_CONFIG_HOME/exeora/` instead, and the CLI says so when it happens. Everything else (gateway, device, projects) is plain JSON; `exeora status` prints the path.

`EXEORA_GATEWAY_URL` points the CLI at a different gateway, which is only useful when working on Exeora itself. It wins over the stored value without overwriting it.

MIT licensed. <https://exeora.dev>

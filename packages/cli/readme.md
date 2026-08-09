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

Requires Node 22 or newer. To keep the binary on your PATH instead of going through `npx`, install
it globally with your preferred package manager:

```bash
npm install -g @exeora/cli
# pnpm add --global @exeora/cli
# yarn global add @exeora/cli
# bun add --global @exeora/cli
# volta install @exeora/cli
exeora connect
```

Later, `exeora upgrade` detects which of those package managers owns the running executable and uses
the same one to install `@exeora/cli@latest`. For unusual custom layouts, set
`EXEORA_PACKAGE_MANAGER` to `npm`, `pnpm`, `yarn`, `bun`, or `volta`.

| Command | What it does |
|---|---|
| `connect [path]` | Sign in, register and serve, skipping whatever is already done |
| `login` / `logout` | Sign in through the browser, or forget the session on this machine |
| `gateway` / `gateway use <url>` / `gateway reset` | Show or change which Exeora this machine talks to |
| `device register` / `device list` | Register this machine by hand, or list your machines |
| `project add [path]` | Register a directory without connecting |
| `project list` / `project remove <slug>` | Manage this machine's projects |
| `sync` | Reconcile this machine's registration and projects with the dashboard |
| `status` | Show registration, gateway and projects |
| `logs` | Recent tool calls: what ran, which client asked, and how it ended |
| `init [path]` | Write an `exeora.toml` restricting what agents may do in a directory |
| `upgrade` | Upgrade through the package manager that owns this installation |

Everything below `connect` in that table is what `connect` does for you. They stay because a script sometimes wants one step without the others.

`connect` takes a few flags for the cases it cannot guess: `--slug` to name the project in its URL, `--name` to name the machine, `--no-add` to serve what is already registered without adding this directory, and `--reset` to register the machine again after revoking it from the dashboard.

`--json` makes `status`, `logs`, `device list` and `project list` print a JSON document instead of drawing on the terminal, and errors become JSON on stderr with a non-zero exit. On `connect`, which never finishes, it prints one JSON object per line as things happen, which is what a supervisor or a log collector can read as it arrives.

## What an agent may do

Set from the dashboard, per project: everything, read only, or only the commands you name. Independently of that, a deny list refuses commands in any mode, and a tool list says which tools exist here at all.

A project may also carry an `exeora.toml` in its root, which `exeora init` writes for you:

```toml
mode = "allow_list"      # allow_all | allow_list | read_only
allow = ["npm", "git *"]
deny = ["sudo", "rm *"]
approve = true
```

**It can only narrow what the account already allows, never widen it**, so whoever controls a machine can restrict an agent further and cannot grant themselves anything. Every key is optional, and leaving one out means the file has no opinion about it rather than asking for the strictest value.

A single word permits that program with any arguments, `git push` permits exactly that, and a trailing `*` stands for whatever follows. Whenever a list is in force, commands carrying shell syntax are refused outright, because `npm test; rm -rf ~` is one command whose first word is `npm`.

`approve` asks before anything that edits, writes or runs. Clients speaking MCP 2026-07-28 are asked in the conversation itself; everyone else, which today includes Claude and ChatGPT, is asked on this terminal and in the dashboard at the same time, and the first answer wins.

It refuses to register your home directory or the filesystem root. A project is the boundary every tool is confined to, so those two would hand over the whole machine.

## Tools an agent can run

`read_file` · `list_files` · `grep` · `edit_file` · `write_file` · `run_command` · `start_command` · `get_command_output` · `send_command_input` · `kill_command`

Every path is resolved and confined to the project root before anything touches the disk.

**A new project allows everything**, which is what every project did before the setting existed. Until you narrow it, an agent connected to a project can run anything inside that directory on whichever machine is serving it. Connect projects you are comfortable letting an agent change, set a policy for the ones you are not, and revoke a machine from the dashboard at <https://exeora.dev> the moment you want it to stop.

A process started with `start_command` dies when this CLI disconnects, so nothing is left running once nobody is watching it.

## Where things are stored

The refresh token goes to the OS keychain. Machines with no secret service, which is most Linux servers and CI containers, get a `0600` file under `$XDG_CONFIG_HOME/exeora/` instead, and the CLI says so when it happens. Everything else (gateway, device, projects) is plain JSON; `exeora status` prints the path.

`EXEORA_GATEWAY_URL` points the CLI at a different gateway for one shell, without overwriting the stored value it outranks.

## Your own gateway

Exeora is open source and self-hostable, so `https://exeora.dev` is a default rather than an address. Point this machine at your own deployment once and the choice is stored, so every later command follows it with no flag and no variable:

```bash
exeora gateway use https://your.example.com
exeora connect
```

`exeora connect --gateway https://your.example.com` does both in one go. `exeora gateway` prints the active one and where it came from, and `exeora gateway reset` goes back to the hosted one.

One gateway is active at a time. Switching forgets the machine registration, the projects and the session belonging to the previous one, because a device id issued by one gateway's database means nothing to another. The CLI lists what it is about to forget and asks before it does, and it checks that a gateway actually answers at the address first, so a typo leaves a working setup exactly as it was.

Deploying a gateway of your own: [self-hosting.md](https://github.com/leynier/exeora/blob/main/docs/self-hosting.md).

AGPL-3.0-only. Full story and monorepo: <https://github.com/leynier/exeora>. Site: <https://exeora.dev>

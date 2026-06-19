# arya-agent

A local autonomous agent and assistant backed by [llama-swap](https://github.com/mostlygeek/llama-swap), served over
WebSocket and built on **mu**. Runs as a terminal TUI or as a server for the companion app.

- **`packages/arya`** — the server (agent sessions, sub-agents, tools, scheduler, WebSocket transport).
- **`packages/arya-companion`** — the Expo/React Native mobile client.

## Quick start

**1. Install** — a self-contained binary, no runtime dependencies:

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/arya/main/install.sh | sh
```

Installs the latest `arya` to `~/.local/bin` (override with `ARYA_INSTALL_DIR`). On Windows, grab
`arya-windows-x64.exe` from the [releases page](https://github.com/gaetan-puleo/arya/releases).

**2. Run a model backend** — arya needs a [llama-swap](https://github.com/mostlygeek/llama-swap) server with at least
one model loaded, reachable at the `baseUrl` you configure below.

**3. Run arya:**

```bash
arya serve         # server for the companion app + TUI clients
arya               # interactive TUI (connects to a running `arya serve`)
```

On first launch with no config, arya walks you through a setup Q&A and writes `~/.config/arya/config.json`.

## Configure

`~/.config/arya/config.json` (falls back to `<repo>/config.json`):

```json
{
  "kind": "llama-swap",
  "baseUrl": "http://localhost:8080",
  "model": "qwen2.5-coder:7b",
  "primaryAgent": "arya",
  "wsPort": 3001,
  "wsHost": "127.0.0.1",
  "authToken": ""
}
```

arya binds to loopback only by default. To expose it on your LAN (`"wsHost": "0.0.0.0"`) you **must** set a non-empty
`authToken`, or arya refuses to start.

## Agents

Agents are markdown files (frontmatter + system-prompt body) under `~/.config/arya/agents/` or
`<repo>/definitions/agents/`:

```markdown
---
name: arya
description: Default Arya primary agent
model: qwen2.5-coder:7b
tools: [read, list, webfetch, write, edit, bash, subagent]
---

You are Arya…
```

arya ships with a built-in `arya` agent, so it works with no file on disk — add one only to override it. `primaryAgent`
picks which agent owns the main prompt; the others are reachable as sub-agents via the `subagent` tool.

## Tools

`read`, `write`, `edit`, `bash`, `list` (filesystem + shell) and `webfetch` are built in. `write`, `edit`, `bash` and
`subagent` go through an approval gate; read-only tools run freely. Install extra plugins with
`arya install <plugin.ts>` (loaded automatically from `~/.config/arya/plugins/`).

## Voice

Set `voiceModel` to an audio-capable model to enable voice. In the TUI, `/voice` transcribes a clip into the composer
and `/call` is hands-free dictation. The companion's call button records audio, arya transcribes it with `voiceModel`,
then answers with the main model. Host recording needs `ffmpeg`, `arecord` or `parecord`. See `CONFIG.md`.

## Scheduled tasks

A `croner` scheduler reads YAML from `<repo>/definitions/tasks/` (or a configured `tasksDir`). Scheduled runs are
non-interactive and auto-approve their tools:

```yaml
- id: daily-summary
  agent: arya
  cron: '0 20 * * *'
  channel: companion
  prompt: Summarise the day.
```

## Development

Run from source (needs [Deno](https://deno.com/); mu is pulled from npm automatically):

```bash
deno task arya:serve     # run the server
deno task arya:tui       # run the TUI
deno task compile        # build standalone binaries into dist/
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the binaries `install.sh` pulls from.

## License

MIT

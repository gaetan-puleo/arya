# arya-agent

A llama-swap-backed coding agent served over WebSocket, built on **mu**
(consumed from the published `mu-*` npm packages, so no sibling checkout is
needed). Ships as a self-contained standalone binary that runs as a local
terminal TUI or a WebSocket server for the companion app.

- **`packages/arya`** — server. Composes the `mu-harness` primitives
  (agent sessions, session store/catalog, sub-agents, hooks, channels) with
  `mu-local-provider`, `mu-ai-tools`, a croner scheduler, and a WebSocket
  transport.
- **`packages/arya-companion`** — Expo/React Native mobile client that
  connects to the server, streams replies, and surfaces approvals,
  sub-agents and slash commands.

## Install

`arya` ships as a self-contained executable (Deno + arya + mu embedded) — no
runtime dependencies. Install with curl:

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/arya/main/install.sh | sh
```

This installs `arya` to `~/.local/bin` (override with `ARYA_INSTALL_DIR` or
pin a version with `ARYA_VERSION`). On Windows, download
`arya-windows-x64.exe` from the
[releases page](https://github.com/gaetan-puleo/arya/releases).

## Configure

arya does not generate any config — create `~/.config/arya/config.json`
yourself (it falls back to `<repo>/config.json`). It binds loopback-only by
default; a LAN bind (`"wsHost": "0.0.0.0"`) requires a non-empty `authToken`
or arya refuses to start.

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

Make sure a llama-swap server is reachable at `baseUrl` with at least one
model loaded, then run:

```bash
arya                     # show help
arya serve               # autonomous host — WebSocket server for channels (companion, TUI)
arya --channel tui       # interactive TUI client — connects to a running `arya serve`
arya --channel tui --connect ws://host:port   # TUI client of a remote arya server
```

The TUI is a **pure client** — start `arya serve` first; the autonomous host owns
the server and the TUI never boots one (run them as two processes, or two TUIs
share one server). The channel layer (WebSocket server + client, the companion
bridge, and the TUI proxy) lives in `mu-harness` (`channels/` —
`webSocketAdapter` / `connectHarness`); arya just registers it.

## Agents

Agents are markdown files (frontmatter + body) under
`~/.config/arya/agents/` or `<repo>/definitions/agents/`. The `mu-harness`
agent schema is `name`, `description`, `model`, `tools` (an allow-list of
tool-name globs), `extends`, body = system prompt:

```markdown
---
name: arya
description: Default Arya primary agent
model: qwen2.5-coder:7b
tools: [read, list_dir, webfetch, write, edit, bash, subagent]
---
You are Arya…
```

arya ships with a built-in `arya` agent, so it works with no `.md` on disk;
drop your own file only to override it. `primaryAgent` in the config selects
which agent supplies the primary system prompt; the rest are reachable as
sub-agents via the `subagent` tool. When the primary delegates, the harness
streams the sub-agent's lifecycle as `sub_agent_event` frames, which the
companion renders as a live preview card with a tap-through detail timeline.

## Tools

Filesystem + shell come from `mu-tools` (`read`, `write`, `edit`, `bash`,
`list_dir`); web fetch from the `mu-webfetch` plugin (`webfetch`). An approval
hook gates `write`, `edit`, `bash` and `subagent` (surfaced to the companion)
before they run; read-only tools run freely. `arya install <path-to-plugin.ts>`
stores a plugin under `~/.config/arya/plugins/`; installed plugins load
automatically at startup. Skills the agent authors are written to
`~/.config/arya/skills/`.

## Voice

Set `voiceModel` to an audio-capable model to enable voice input. In the TUI, `/voice`
records a clip and transcribes it into the composer and `/call` is hands-free realtime
dictation. The companion's call button records audio and sends it on the chat stream —
arya routes the audio turn to `voiceModel` for transcription, then answers with the main
model (both stay resident in llama-swap, so there's no model-swap cost). Recording needs a
microphone recorder on the host (ffmpeg / arecord / parecord); if `voiceModel` is unset,
voice falls back to the selected model when it accepts audio. See `CONFIG.md`.

## Scheduled tasks

A `croner`-backed scheduler reads YAML from `<repo>/definitions/tasks/` (or a
configured `tasksDir`). Scheduled runs are non-interactive and auto-approve
their tools:

```yaml
- id: daily-summary
  agent: arya
  cron: '0 20 * * *'
  channel: companion
  prompt: Summarise the day.
```

## Development

Build the standalone binaries locally (cross-compiles into `dist/arya-*`):

```bash
deno task compile              # all targets
deno task compile linux-x64    # one target
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which cross-compiles
the binaries and attaches them to the GitHub release that `install.sh` pulls
from.

## License

MIT

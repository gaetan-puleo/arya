# arya-agent

A llama-swap-backed coding agent served over WebSocket, built on **mu**.

- **`packages/arya`** — Node.js server. Composes `mu-harness` with
  `mu-local-provider`, `mu-tools`, `mu-webfetch`, the harness scheduler,
  and a WebSocket transport.
- **`packages/arya-companion`** — Expo/React Native mobile client that
  connects to the server, streams replies, and surfaces approvals,
  sub-agents and slash commands.

## Quick start

```bash
# 1. Install
cd arya-agent && bun install   # or pnpm/npm install

# 2. Make sure a llama-swap server is reachable (e.g. http://localhost:8080)
#    with at least one model loaded.

# 3. Scaffold XDG config
npx arya init
# writes ~/.config/arya/{config.json, agents/, tasks/}

# 4. Run
bun run dev          # or: bun run start
```

Server config lives at `~/.config/arya/config.json` (template below). It
binds loopback-only by default; LAN bind requires a non-empty `authToken`.

```json
{
  "baseUrl": "http://localhost:8080/v1",
  "model": "qwen2.5-coder:7b",
  "wsPort": 3001,
  "wsHost": "127.0.0.1",
  "authToken": ""
}
```

## Agents

Agents are markdown files (frontmatter + body) under
`~/.config/arya/agents/` or `<repo>/definitions/agents/`. See `mu-harness`
for the full schema (`id`, `description`, `type`, `enabled`, `model`,
`tools:` permissions map, body = system prompt).

## Tools

Filesystem + shell come from `mu-tools` (`read`, `write`, `edit`, `bash`,
`list_dir`). Web fetch comes from `mu-webfetch` (`webfetch`). Additional
plugins can be installed via `arya install <npm:spec | path.ts>` — they
load from `$XDG_DATA_HOME/arya/plugins/`.

## Scheduled tasks

`croner`-backed scheduler reads YAML from `~/.config/arya/tasks/` (or
`<repo>/definitions/tasks/`):

```yaml
- id: daily-summary
  agent: assistant
  cron: '0 20 * * *'
  channel: companion
  prompt: Summarise the day.
```

## License

MIT

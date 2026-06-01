# arya-agent

A llama-swap-backed coding agent served over WebSocket, built on **mu**.

- **`packages/arya`** — server. Composes the new `mu-harness` primitives
  (agent sessions, session store/catalog, sub-agents, hooks, channels) with
  `mu-local-provider`, arya's built-in tool set, a croner scheduler, and a
  WebSocket transport.
- **`packages/arya-companion`** — Expo/React Native mobile client that
  connects to the server, streams replies, and surfaces approvals,
  sub-agents and slash commands.

The companion is wired in as a harness `Channel`: each session is wrapped in
a `createChannel(...)` whose `AgentSessionEvent` stream is translated into the
companion's WebSocket wire frames (`packages/arya/src/companion-channel.ts`).

## Quick start

```bash
# 1. Make sure a llama-swap server is reachable (e.g. http://localhost:8080)
#    with at least one model loaded.

# 2. Scaffold XDG config
deno task init
# writes ~/.config/arya/{config.json, agents/arya.md, plugins/}

# 3. Run
deno task dev          # or: deno task start
```

Server config lives at `~/.config/arya/config.json` (template below). It
binds loopback-only by default; a LAN bind (`"wsHost": "0.0.0.0"`) requires a
non-empty `authToken` or arya refuses to start.

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

## Agents

Agents are markdown files (frontmatter + body) under
`~/.config/arya/agents/` or `<repo>/definitions/agents/`. The new
`mu-harness` agent schema is `name`, `description`, `model`, `tools` (an
allow-list of tool-name globs), `extends`, body = system prompt:

```markdown
---
name: arya
description: Default Arya primary agent
model: qwen2.5-coder:7b
tools: [read, list_dir, webfetch, write, edit, bash, subagent]
---
You are Arya…
```

`primaryAgent` in the config selects which agent supplies the primary system
prompt; the rest are reachable as sub-agents via the `subagent` tool.

### Sub-agent previews

When the primary delegates via the `subagent` tool, the harness `runSubAgent`
drives the run while arya observes the spawned session (`src/runtime.ts`
`onSubAgentSpawn` → `src/sub-agent-channel.ts`) and streams its lifecycle as
`sub_agent_event` frames (`started` / `content` / `tool_call` / `tool_result`
/ `completed` / `error`). The companion reduces these into a live preview card
in the parent transcript and a tap-through detail timeline of the sub-agent
session — no extra server-side persistence required.

## Tools

Filesystem + shell come from `mu-tools` (`read`, `write`, `edit`, `bash`,
`list_dir`); web fetch from the `mu-webfetch` plugin (`webfetch`). Both are
passed straight into `createHarness` (`tools` + `plugins`). Safety is enforced
by an approval hook — `write`, `edit`, `bash` and `subagent` prompt for
approval (surfaced to the companion) before running; read-only tools run
freely. `arya install <path-to-plugin.ts>` stores a plugin file under
`$XDG_CONFIG_HOME/arya/plugins/`.

## Scheduled tasks

`croner`-backed scheduler reads YAML from `<repo>/definitions/tasks/` (or a
configured `tasksDir`). Scheduled runs are non-interactive and auto-approve
their tools:

```yaml
- id: daily-summary
  agent: arya
  cron: '0 20 * * *'
  channel: companion
  prompt: Summarise the day.
```

## License

MIT

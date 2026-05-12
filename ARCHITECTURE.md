# arya-agent — Architecture

arya is the **WebSocket host** for mu. It glues mu-core + mu-agents +
mu-tools + mu-scheduler to a WS channel and a React Native companion
app.

## Layers

| Layer | Owns | Lives in |
|---|---|---|
| **L3 — `arya` (server)** | WS protocol, session JSONL files, channel-specific routing, slash command extensions | `packages/arya/` |
| **L4 — `arya-companion` (client)** | React Native UI: rendering, gestures, modals, keyboard, theme | `packages/arya-companion/` |

mu (L1 SDK + L2 plugins) is consumed via `file:` deps to the sibling
repo. See `../mu/ARCHITECTURE.md` for the SDK shape.

## L3 — arya server

```
packages/arya/src/
├── index.ts                       # CLI entry
├── init.ts                        # `arya init` scaffolder
├── bootstrap.ts                   # Thin: load config, startMu, wire channel + scheduler
├── bootstrap/
│   ├── config.ts                  # config.json loader (fails fast)
│   ├── env-loader.ts              # .env parser
│   ├── paths.ts                   # XDG path resolvers
│   └── plugin-loader.ts           # User plugin discovery
├── ws-channel.ts                  # Connection lifecycle + frame routing ONLY
├── ws/
│   ├── chat-handler.ts            # Wraps mu-core's runHostTurn (5 LOC of real logic)
│   ├── command-handler.ts         # Slash command parsing + execution
│   ├── sessions-handler.ts        # sessions:* CRUD
│   ├── approval.ts                # Approval channel + inbound response routing
│   ├── approval-snapshot.ts       # Pushes approval_state from mu-agents' gateway
│   ├── sub-agent-snapshot.ts      # Pushes sub_agent_run from mu-agents' registry
│   ├── stream-subscriber.ts       # Pushes stream/done/error per session (persistence delegated to mu-core)
│   └── connection-state.ts        # Per-WS bookkeeping (running turns + lazy subscriptions)
├── lib/
│   ├── logger.ts                  # Scoped console logger
│   └── enrichAuthor.ts            # agentId → AgentInfo at wire boundary
└── plugins/
    ├── commands.ts                # /help slash command
    └── tools/
        ├── index.ts
        └── http-tools.ts          # http.fetch (arya-specific)
```

### Wire protocol

**Companion → Server**

| Type | Payload | Purpose |
|---|---|---|
| `chat` | `{ text, sessionId? }` | User message → triggers turn via `runHostTurn` |
| `command` | `{ text, sessionId? }` | Slash command (`/help`) |
| `approval_response` | `{ approvalId, token, action }` | Resolve a pending approval |
| `set_active_agent` | `{ agentId }` | Switch primary agent |
| `sessions:*` | CRUD on persisted sessions | |

**Server → Companion (snapshots, not deltas)**

| Type | Payload | Source |
|---|---|---|
| `stream` / `done` | streaming text + turn end | per-session subscription |
| `sub_agent_run` | `SubAgentRunSnapshot` | `mu-agents`' run registry, projected |
| `sub_agent_runs:listed` | `SubAgentRunSnapshot[]` | bootstrap on connect |
| `approval_state` | `ApprovalSnapshot` (with pre-formatted `toolArgsPretty`) | `mu-agents`' gateway |
| `approvals:listed` | `ApprovalSnapshot[]` | bootstrap on connect |
| `synthetic_message` | `ChatMessage & { author? }` | mu-agents' bus.append, server-filtered + author-enriched |
| `active_agent` | `{ agentId }` | mu-agents' manager change |
| `commands` / `agents` | registries | on connect + change |
| `sessions:*` | persisted-session events | sessions handler |
| `scheduler_event` | task lifecycle | mu-scheduler |
| `error` | string | error UI |

## L4 — arya-companion (pure renderer)

```
packages/arya-companion/src/
├── app/                           # Expo Router screens
├── components/                    # React Native rendering ONLY
├── theme/                         # Theme tokens + provider
├── hooks/
│   ├── useChat.ts                 # Screen-local state orchestrator
│   ├── chatDispatch.ts            # Per-message UI dispatcher (streaming placeholder + transcript inserts)
│   ├── useKeyboard.ts, useSlashAndAt.ts
└── lib/
    ├── ws.ts                      # Wire-type discriminated union
    ├── ws-client.ts               # Reconnecting socket
    ├── wsConfig.ts                # AsyncStorage settings
    ├── sessionWire.ts             # Thin re-exports of mu-core projectMessage
    └── appStore.ts                # Zustand store — pure snapshot mirror, ZERO derivation
```

The companion has **no state derivation**. `subAgentRuns` and
`approvals` are `Map<id, Snapshot>` populated verbatim from server
events. Components read snapshots and render.

## Responsibility split

| Concern | Lives in |
|---|---|
| Agent state machine | mu-agents (L2) — `SubagentRunRegistry`, `ApprovalGateway`, `AgentManager` |
| Snapshot projection (wire shape) | mu-agents (L2) — `getSnapshot`, `listSnapshots`, `subscribeAllSnapshots` |
| Session persistence (JSONL) | mu-core (L1) — `attachAutoPersist` middleware |
| Chat-turn orchestration | mu-core (L1) — `runHostTurn` |
| Message factories | mu-core (L1) — `makeUser/Assistant/Tool/SyntheticMessage` |
| Message → display projection | mu-core (L1) — `projectMessage` |
| Session-scoped message bus | mu-core (L1) — `createSessionScopedMessageBus` |
| WS frame routing | arya (L3) — `ws-channel.ts` |
| WS protocol shape | arya (L3) — wire types in `companion/lib/ws.ts` |
| Author enrichment | arya (L3) — `enrichAuthor.ts` |
| Rendering | companion (L4) — React Native components |

## Adding a new channel

To add a Telegram bot, web SPA, voice CLI, etc.:

1. Construct `createSessionScopedMessageBus({ resolveSession, onSyntheticAppend })`.
2. Call `startMu({ messages: bus, plugins: [...] })`.
3. `attachAutoPersist` on every session via `handle.sessions.onSessionCreated`.
4. Subscribe to `mu-agents`' `runs.subscribeAllSnapshots` and `approvalGateway.subscribeAllSnapshots`; push them over your channel.
5. On inbound user text, call `runHostTurn({ session, registry, messageBus: bus, userText, config })`.

The work in arya is ~600 LOC of channel-specific glue. Domain logic lives in mu.

## Sessions

Persisted to JSONL under `$XDG_DATA_HOME/arya/sessions/` (defaults to
`~/.local/share/arya/sessions/`). One file per session. Auto-persist
middleware writes:

- User messages: at chat-handler / command-handler invocation time
- Assistant messages: on `stream_ended`, stamped with the active `agent` via mu-core's `makeAssistantMessage` factory
- Tool messages: on `stream_ended`, diffed from a per-session cursor

Cursor lives in mu-core's `attachAutoPersist` middleware — one per
session, not per connection, so multi-client scenarios don't
double-write.

## Configuration

`~/.config/arya/config.json` — runtime config (LLM endpoint, model, WS port, auth token).
`~/.config/arya/.env` — plugin env vars only.
`~/.config/arya/agents/` — markdown agent definitions.
`~/.config/arya/tasks/` — YAML scheduled tasks.
`~/.config/arya/plugins/` — user-defined plugin `.ts` files.

## Plugin loading

User plugins live in `~/.config/arya/plugins/*.ts`. The loader
exception-probes `createXxx` factories for two shapes: full `Plugin`
or standalone `PluginTool`. Deps install to
`$XDG_DATA_HOME/arya/plugins/node_modules`.

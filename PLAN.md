# arya-agent

Autonomous multi-agent runtime powered by mu.

## Vision

**arya-agent** = **mu comme moteur** + **Companion channel (WebSocket)** + **Scheduler autonome** + **Plugins métiers**

- **arya** (server) : backend Node.js basé sur mu-core + mu-agents
- **arya-companion** (mobile) : app Expo/React Native — chat client WebSocket

### Buts

1. **Server arya** : un serveur autonome qui fait tourner des agents mu avec un channel WebSocket pour communiquer avec le companion mobile
2. **Companion mobile** : une app React Native/Expo pour chatter avec les agents, gérer les approbations d'outils, et suivre les sous-agents
3. **Extensibilité** : système de plugins pour ajouter des outils (fs, shell, http, calendar, email, homeassistant, obsidian, qonto, etc.)
4. **Autonomie** : scheduler cron/heartbeat pour exécuter des tâches automatiques

### Architecture Globale

```
┌──────────────────────────────────────────────────────┐
│                    arya (server)                      │
├──────────────────────────────────────────────────────┤
│  startMu() — mu-core bootstrap                       │
│  ├── PluginRegistry (tools, hooks)                   │
│  ├── SessionManager (multi-session)                  │
│  ├── ChannelRegistry                                 │
│  ├── ApprovalGateway (ask permissions)               │
│  ├── ActivityBus                                     │
│  └── WebSocketChannel (companion)                    │
│       ├── InboundMessage → Session.submit()          │
│       ├── ApprovalRequest → companion (WS)           │
│       ├── ActivityEvent → companion (WS)             │
│       └── SubAgentEvent → companion (WS)             │
├──────────────────────────────────────────────────────┤
│  Scheduler (croner)                                   │
│  ├── Cron tasks → Session.submit()                   │
│  └── Heartbeat tasks → interval                      │
├──────────────────────────────────────────────────────┤
│  Configuration XDG                                    │
│  ├── ~/.config/arya/config.json                      │
│  ├── ~/.config/arya/agents/*.md                      │
│  └── ~/.config/arya/tasks/*.yaml                     │
└──────────────────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌──────────────────────────────────────────────────────┐
│              arya-companion (mobile)                   │
├──────────────────────────────────────────────────────┤
│  Expo Router + Tamagui UI                             │
│  ├── ChatScreen (FlashList, streaming)               │
│  ├── Approval system (approve/deny)                  │
│  ├── SubAgentCard (invocation tracking)              │
│  ├── Command menu (/)                                │
│  └── Agent menu (@)                                  │
└──────────────────────────────────────────────────────┘
```

---

## 📁 Structure du Projet

```
arya-agent/
├── packages/
│   ├── arya/                     # Server backend (mu-core + mu-agents)
│   │   ├── src/
│   │   │   ├── bootstrap.ts      # startMu wrapper + config XDG
│   │   │   ├── ws-channel.ts     # WebSocket channel (companion)
│   │   │   ├── scheduler.ts      # Cron/heartbeat tasks
│   │   │   ├── definitions.ts    # Load agents from markdown
│   │   │   ├── init.ts           # arya init command
│   │   │   └── plugins/
│   │   │       └── tools/        # Tool plugins (à venir)
│   │   ├── bin/
│   │   │   └── arya.js           # CLI entry (arya init | arya)
│   │   └── package.json
│   │
│   └── arya-companion/           # Mobile app (Expo/React Native)
│       ├── app/                  # Expo Router screens
│       ├── src/
│       │   ├── lib/ws.ts         # WebSocket client
│       │   ├── components/       # Chat, Approval, SubAgentCard
│       │   └── tamagui.config.ts # Design system
│       └── package.json
│
├── definitions/                  # ← Supprimé (migré vers ~/.config/arya)
├── config.example.json           # ← Supprimé (migré vers ~/.config/arya)
├── package.json                  # Workspace root
├── tsconfig.json
└── README.md
```

---

## 📁 Configuration XDG

### Structure de `~/.config/arya/`

```
~/.config/arya/
├── config.json           # Config LLM, WebSocket, plugins
├── agents/               # Fichiers .md des agents
│   └── assistant.md
├── tasks/                # Fichiers .yaml des tasks
│   └── default.yaml
└── plugins/              # Config des plugins (à venir)
    └── (vide)
```

### Initialisation

```bash
arya init
# Crée automatiquement ~/.config/arya/ avec des templates
```

### `~/.config/arya/config.json`

```json
{
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5-coder:7b",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 60000,
  "wsPort": 3001,
  "authToken": "",
  "plugins": ["arya-tools"]
}
```

### `~/.config/arya/agents/assistant.md`

```markdown
---
id: assistant
description: Assistant général pour arya-agent
type: primary
enabled: true
model: qwen2.5-coder:7b
tools:
  fs.read_file: allow
  fs.write_file: ask
  fs.list_dir: allow
  shell.execute: ask
  http.fetch: allow
  subagent: ask
---
You are a helpful assistant powered by arya-agent. You can use tools to interact with the filesystem, execute shell commands, and make HTTP requests. For sensitive operations, you will need approval from the user.

You may delegate work to subagents when appropriate. Use the `subagent` tool with a clear task description.
```

### `~/.config/arya/tasks/default.yaml`

```yaml
- id: hello-task
  agent: assistant
  cron: "0 9 * * *"
  channel: companion
  prompt: Say hello and introduce yourself.

- id: daily-summary
  agent: assistant
  cron: "0 20 * * *"
  channel: companion
  prompt: Summarize the day's activities and any pending tasks.
```

---

## 🔧 Architecture

### 1. Agent Definition (Format mu)

```markdown
---
id: assistant
description: Assistant général pour arya-agent
type: primary
enabled: true
model: qwen2.5-coder:7b
tools:
  fs.read_file: allow
  fs.write_file: ask
  shell.execute: ask
  http.fetch: allow
  subagent: ask
---
You are a helpful assistant powered by arya-agent.
```

**Champs frontmatter :**
- `id` : Identifiant unique
- `description` : Description courte
- `type` : `primary` ou `subagent`
- `enabled` : `true`/`false`
- `model` : `provider/model-id` (optionnel)
- `tools` : Map de permissions (`allow` | `deny` | `ask`)
- **Body** : Système prompt

### 2. Task Definition (YAML)

```yaml
- id: hello-task
  agent: assistant
  cron: "0 9 * * *"
  channel: companion
  prompt: Say hello and introduce yourself.
```

### 3. Bootstrap (Chargement XDG)

```typescript
function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME 
    ?? join(homedir(), '.config');
}

function loadConfig(): BootstrapConfig {
  const configDir = join(xdgConfig(), 'arya');
  const configPath = join(configDir, 'config.json');
  
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}\nRun: arya init`);
  }
  
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  
  return {
    baseUrl: raw.baseUrl ?? 'http://localhost:11434/v1',
    model: raw.model ?? 'qwen2.5-coder:7b',
    maxTokens: raw.maxTokens ?? 4096,
    temperature: raw.temperature ?? 0.7,
    streamTimeoutMs: raw.streamTimeoutMs ?? 60000,
    wsPort: raw.wsPort ?? 3001,
    authToken: raw.authToken ?? '',
    agentsDir: join(configDir, 'agents'),
    tasksDir: join(configDir, 'tasks'),
  };
}
```

---

## 📦 Dépendances

**Root `package.json` :**
```json
{
  "name": "arya-agent",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "start": "cd packages/arya && bun run src/index.ts",
    "dev": "cd packages/arya && bun --watch run src/index.ts"
  }
}
```

**`arya/package.json` :**
```json
{
  "name": "arya",
  "version": "0.1.0",
  "dependencies": {
    "mu-core": "0.15.0",
    "mu-agents": "0.15.0",
    "mu-openai-provider": "0.15.0",
    "croner": "^10.0.1",
    "yaml": "^2.8.4",
    "ws": "^8.19.0"
  },
  "bin": {
    "arya": "./bin/arya.js"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts",
    "init": "bun run src/init.ts"
  }
}
```

**`arya-companion/package.json` :**
```json
{
  "name": "arya-companion",
  "main": "expo-router/entry",
  "version": "1.0.0",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "lint": "expo lint"
  },
  "dependencies": {
    "@expo/vector-icons": "^15.0.3",
    "@react-native-async-storage/async-storage": "2.2.0",
    "@react-navigation/native": "^7.1.8",
    "@shopify/flash-list": "2.0.2",
    "@tamagui/animations-react-native": "^2.0.0-rc.41",
    "@tamagui/button": "^2.0.0-rc.41",
    "@tamagui/core": "^2.0.0-rc.41",
    "@tamagui/font-inter": "^2.0.0-rc.41",
    "@tamagui/input": "^2.0.0-rc.41",
    "@tamagui/label": "^2.0.0-rc.41",
    "@tamagui/stacks": "^2.0.0-rc.41",
    "@tamagui/text": "^2.0.0-rc.41",
    "@tamagui/theme": "^2.0.0-rc.41",
    "expo": "~54.0.34",
    "expo-build-properties": "~1.0.10",
    "expo-clipboard": "~8.0.8",
    "expo-constants": "~18.0.13",
    "expo-font": "~14.0.11",
    "expo-haptics": "~15.0.8",
    "expo-linking": "~8.0.12",
    "expo-router": "~6.0.23",
    "expo-splash-screen": "~31.0.13",
    "expo-status-bar": "~3.0.9",
    "react": "19.1.0",
    "react-native": "0.81.5",
    "react-native-code-highlighter": "^1.3.0",
    "react-native-keyboard-controller": "1.18.5",
    "react-native-reanimated": "~4.1.1",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-worklets": "0.5.1",
    "react-syntax-highlighter": "^16.1.1",
    "tamagui": "^2.0.0-rc.41"
  },
  "devDependencies": {
    "@types/react": "~19.1.0",
    "@types/react-syntax-highlighter": "^15.5.13",
    "eslint": "^9.0.0",
    "eslint-config-expo": "~10.0.0",
    "react-test-renderer": "19.1.0",
    "typescript": "~5.9.2"
  },
  "private": true
}
```

---

## 🗓️ Phases d'Implémentation

### Phase 1 : Bootstrap (1 jour) ✅
- [x] `arya/package.json` avec mu-core, mu-agents, ws
- [x] `arya/src/bootstrap.ts` — `startMu()` wrapper
- [x] `arya/src/index.ts` — entry point CLI
- [x] `arya/bin/arya.js` — shebang entry
- [x] Config Ollama par défaut

### Phase 2 : WebSocket Channel (1-2 jours) ✅
- [x] `arya/src/ws-channel.ts` — implémente `Channel` de mu-core
- [x] `InboundMessage` → `Session.submit()`
- [x] `ApprovalRequest` → push WebSocket vers companion
- [x] `ActivityEvent` → push WebSocket vers companion
- [x] `SubAgentEvent` → push WebSocket vers companion
- [x] Auth token optionnel
- [x] `commands`/`agents` request handling
- [x] `done` event handling
- [x] Approval protocol alignment (requestId/token)

### Phase 3 : Agent Definitions (1 jour) ✅
- [x] `arya/src/definitions.ts` — `loadAgentsFromDir()`
- [x] Charger agents depuis `~/.config/arya/agents/*.md`
- [x] Parser YAML pour tasks (phase 5)
- [x] Exemple `assistant.md`

### Phase 4 : Scheduler (1 jour) ✅
- [x] `arya/src/scheduler.ts` — croner integration
- [x] Tasks cron → `Session.submit()`
- [x] Tasks heartbeat → interval
- [x] Logging des exécutions

### Phase 5 : Plugins Outils (2-3 jours) ✅
- [x] Registry de plugins (fs, shell, http)
- [x] Permissions (`allow`/`deny`/`ask`) via `matchKey` + globs
- [x] Outils implémentés : `fs.read_file`, `fs.write_file`, `fs.list_dir`, `shell.execute`, `http.fetch`
- [x] Noms des outils alignés avec les définitions d'agents

### Phase 6 : Configuration XDG (1 jour) ✅
- [x] `arya/src/init.ts` — `arya init` command
- [x] `~/.config/arya/config.json` template
- [x] `~/.config/arya/agents/` template
- [x] `~/.config/arya/tasks/` template
- [x] `bootstrap.ts` — chargement config XDG + fallback local
- [x] `arya.js` — sous-commande `init`

### Phase 7 : Affinement (1 jour) ✅
- [x] Logs & error handling
- [x] README.md à jour
- [x] `.env.example` avec toutes les variables
- [x] Variables d'environnement `ARYA_*` dans `bootstrap.ts`

---

## 🔌 WebSocket Protocol

**Companion → Server :**
```json
// Chat message
{ "type": "chat", "text": "Hello!", "sessionId": "default" }

// Command
{ "type": "command", "text": "/help", "sessionId": "default" }

// Commands request (re-fetch)
{ "type": "commands" }

// Agents request (re-fetch)
{ "type": "agents" }

// Approval response
{ "type": "approval_response", "requestId": "...", "token": "...", "action": "approve" | "deny" }
```

**Server → Companion :**
```json
// Streaming response
{ "type": "stream", "text": "partial...", "sessionId": "default" }

// Done
{ "type": "done", "text": "full response", "sessionId": "default" }

// Approval request
{ "type": "approval_request", "requestId": "...", "token": "...", "toolName": "fs.read_file", "toolArgs": {...}, "agentId": "assistant", "channelId": "websocket" }

// Approval response confirmation
{ "type": "approval_response", "requestId": "...", "token": "...", "action": "approved" | "denied" }

// Activity event
{ "type": "activity", "event": { "kind": "tool_start", "source": "assistant", "summary": "..." } }

// Sub-agent event
{ "type": "sub_agent_event", "event": { "runId": "...", "agentId": "...", "kind": "invocation_start", "ts": 1234567890 } }

// Commands list (on connect)
{ "type": "commands", "commands": [{ "command": "help", "description": "Show help" }] }

// Agents list (on connect)
{ "type": "agents", "agents": [{ "id": "assistant", "description": "General assistant" }] }

// Error
{ "type": "error", "message": "..." }
```

---

## 📝 Notes Techniques

### Bootstrap (`arya/src/bootstrap.ts`)

```typescript
import { startMu } from 'mu-core';
import { createAgentsPlugin, loadAgentsFromDir } from 'mu-agents';
import { createOpenAIProvider } from 'mu-openai-provider';
import { createWebSocketChannel } from './ws-channel';
import { createScheduler } from './scheduler';

export async function bootstrap() {
  const config = loadConfig(); // ← XDG path
  const agentsDir = config.agentsDir; // ← ~/.config/arya/agents
  
  const handle = await startMu({
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      streamTimeoutMs: config.streamTimeoutMs,
    },
    plugins: [
      createOpenAIProviderPlugin({ id: 'openai' }),
      createAgentsPlugin({
        agentsDir,
        config: {
          baseUrl: config.baseUrl,
          model: config.model,
        },
        approvalChannelId: 'websocket',
      }),
    ],
  });

  // Register WebSocket channel
  handle.channels.register(createWebSocketChannel(
    handle.sessions,
    handle.registry,
    handle.activity,
    { port: config.wsPort, authToken: config.authToken }
  ));

  // Start scheduler
  const scheduler = createScheduler(handle.sessions, config.tasksDir);

  return { handle, scheduler };
}
```

### WebSocket Channel (`arya/src/ws-channel.ts`)

```typescript
import { WebSocket, WebSocketServer } from 'ws';
import type { Channel, ChannelResponder, InboundMessage, SessionManager, PluginRegistry, ActivityBus } from 'mu-core';
import type { ApprovalGateway, ApprovalRequest, ApprovalChannel } from 'mu-agents';

export interface WsChannelOptions {
  port: number;
  authToken?: string;
}

export function createWebSocketChannel(
  sessions: SessionManager,
  registry: PluginRegistry,
  activity: ActivityBus,
  options: WsChannelOptions,
): Channel {
  const wss = new WebSocketServer({ port: options.port });
  const clients = new Map<WebSocket, ConnectedClient>();

  // Create approval channel
  const approvalChannel: ApprovalChannel = {
    sendApprovalRequest: async (req: ApprovalRequest) => {
      push({
        type: 'approval_request',
        requestId: req.id,
        token: req.token,
        toolName: req.toolName,
        toolArgs: req.toolArgs,
        agentId: req.agentId,
        channelId: req.channelId,
      });
      return undefined;
    },
  };

  wss.on('connection', (ws, req) => {
    // Auth check
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (options.authToken && token !== options.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionId = url.searchParams.get('sessionId') || 'default';
    clients.set(ws, { ws, sessionId });

    // Register approval channel
    const muAgentsPlugin = registry.getPlugin('mu-agents');
    if (muAgentsPlugin?.approvalGateway) {
      muAgentsPlugin.approvalGateway.registerChannel('websocket', approvalChannel);
    }

    // Send commands and agents on connect
    ws.send(JSON.stringify({ type: 'commands', commands: registry.getCommands?.() ?? [] }));
    ws.send(JSON.stringify({ type: 'agents', agents: registry.getAgents?.() ?? [] }));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      // Commands/agents request
      if (msg.type === 'commands') {
        ws.send(JSON.stringify({ type: 'commands', commands: registry.getCommands?.() ?? [] }));
        return;
      }
      if (msg.type === 'agents') {
        ws.send(JSON.stringify({ type: 'agents', agents: registry.getAgents?.() ?? [] }));
        return;
      }

      if (msg.type === 'chat' || msg.type === 'command') {
        const targetSessionId = msg.sessionId || sessionId;
        const session = sessions.getOrCreate(targetSessionId);
        const inbound: InboundMessage = {
          kind: 'text',
          channelId: 'websocket',
          sessionId: targetSessionId,
          text: String(msg.text ?? ''),
        };
        session.submit(inbound, {
          sendText: async (text) => {
            push({ type: 'stream', text, sessionId: targetSessionId });
          },
          onDone: async (text) => {
            push({ type: 'done', text, sessionId: targetSessionId });
          },
        });
      } else if (msg.type === 'approval_response') {
        const gateway = registry.getPlugin('mu-agents')?.approvalGateway as ApprovalGateway | undefined;
        if (!gateway) {
          console.warn('[ws] No approval gateway found');
          return;
        }
        const action = msg.action === 'approve' ? 'approved' : 'denied';
        const token = String(msg.token ?? msg.requestId ?? '');
        if (action === 'approved') {
          gateway.approve(token);
        } else {
          gateway.deny(token);
        }
        push({ type: 'approval_response', requestId: msg.requestId ?? msg.token, token, action });
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Helper to push events to all clients
  function push(event: Record<string, unknown>) {
    const data = JSON.stringify(event);
    for (const [, client] of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  // Subscribe to activity bus
  activity.subscribe((event) => push({ type: 'activity', event }));
  activity.subscribeSubAgent((event) => push({ type: 'sub_agent_event', event }));

  return {
    id: 'websocket',
    start: async () => console.log(`[ws] Listening on port ${options.port}`),
    stop: async () => {
      for (const [, client] of clients) {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
      }
      wss.close();
    },
    push,
    pushError: (message: string) => push({ type: 'error', message }),
  };
}
```

### Scheduler (`arya/src/scheduler.ts`)

```typescript
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { parse } from 'yaml';
import type { SessionManager } from 'mu-core';

export interface ScheduledTask {
  id: string;
  agent: string;
  cron: string;
  channel: string;
  prompt: string;
}

export function createScheduler(sessions: SessionManager, tasksDir?: string) {
  const jobs: Array<{ stop: () => void }> = [];

  if (!tasksDir || !existsSync(tasksDir)) {
    console.log('[scheduler] No tasks directory configured');
    return { stop: () => {} };
  }

  const files = readdirSync(tasksDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (files.length === 0) {
    console.log('[scheduler] No task files found in', tasksDir);
    return { stop: () => {} };
  }

  for (const file of files) {
    const filePath = join(tasksDir, file);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parse(raw);
    const tasks: ScheduledTask[] = Array.isArray(parsed) ? parsed : [parsed as ScheduledTask];

    for (const task of tasks) {
      if (!task.id || !task.cron || !task.prompt) {
        console.warn(`[scheduler] Skipping invalid task in ${file}: missing id/cron/prompt`);
        continue;
      }

      const job = Cron(task.cron, async () => {
        try {
          const sessionId = `task:${task.id}:${Date.now()}`;
          const session = sessions.getOrCreate(sessionId, {
            systemPrompt: `You are a task agent for arya-agent. Task: ${task.id}`,
          });

          const inbound = {
            kind: 'text' as const,
            channelId: 'scheduler',
            sessionId,
            text: task.prompt,
          };

          await session.submit(inbound, {
            sendText: async (text) => {
              console.log(`[scheduler:${task.id}] ${text.slice(0, 200)}`);
            },
          });
        } catch (err) {
          console.error(`[scheduler:${task.id}] Error:`, err);
        }
      }, { timezone: 'UTC', catch: false });

      jobs.push({ stop: () => job.stop() });
    }
  }

  return {
    stop: () => {
      for (const job of jobs) job.stop();
    },
  };
}
```

### Init (`arya/src/init.ts`)

```typescript
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME 
    ?? join(homedir(), '.config');
}

export function init() {
  const configDir = join(xdgConfig(), 'arya');
  const dirs = [
    join(configDir, 'agents'),
    join(configDir, 'tasks'),
    join(configDir, 'plugins'),
  ];

  // Create directories
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Create config.json
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b',
      maxTokens: 4096,
      temperature: 0.7,
      streamTimeoutMs: 60000,
      wsPort: 3001,
      authToken: '',
      plugins: ['arya-tools'],
    }, null, 2));
  }

  // Create agent template
  const agentPath = join(configDir, 'agents', 'assistant.md');
  if (!existsSync(agentPath)) {
    writeFileSync(agentPath, `---
id: assistant
description: Assistant général pour arya-agent
type: primary
enabled: true
model: qwen2.5-coder:7b
tools:
  fs.read_file: allow
  fs.write_file: ask
  fs.list_dir: allow
  shell.execute: ask
  http.fetch: allow
  subagent: ask
---
You are a helpful assistant powered by arya-agent. You can use tools to interact with the filesystem, execute shell commands, and make HTTP requests. For sensitive operations, you will need approval from the user.

You may delegate work to subagents when appropriate. Use the \`subagent\` tool with a clear task description.`);
  }

  // Create tasks template
  const tasksPath = join(configDir, 'tasks', 'default.yaml');
  if (!existsSync(tasksPath)) {
    writeFileSync(tasksPath, `- id: hello-task
  agent: assistant
  cron: "0 9 * * *"
  channel: companion
  prompt: Say hello and introduce yourself.

- id: daily-summary
  agent: assistant
  cron: "0 20 * * *"
  channel: companion
  prompt: Summarize the day's activities and any pending tasks.`);
  }

  console.log('✅ Arya initialized!');
  console.log(`   Config: ${configDir}`);
  console.log(`   Agents: ${join(configDir, 'agents')}`);
  console.log(`   Tasks: ${join(configDir, 'tasks')}`);
}
```

---

## 🚀 Prochaines Étapes

1. ✅ Créer `arya/package.json` avec mu-core, mu-agents, ws
2. ✅ Implémenter `bootstrap.ts` — `startMu()` wrapper
3. ✅ Implémenter `ws-channel.ts` — WebSocket channel pour companion
4. ✅ Implémenter `scheduler.ts` — cron/heartbeat tasks
5. ✅ Ajouter la configuration XDG (`arya init`)
6. ✅ Implémenter les plugins outils (fs, shell, http) — noms alignés
7. ✅ Variables d'environnement `ARYA_*` dans `bootstrap.ts`
8. ⬜ Tests unitaires
9. ⬜ Plugins additionnels (calendar, email, homeassistant, obsidian, qonto)

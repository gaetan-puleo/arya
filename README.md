# arya-agent

Autonomous multi-agent runtime powered by **mu**.

## Vision

**arya-agent** = **mu comme moteur** + **Companion channel (WebSocket)** + **Scheduler autonome** + **Système de plugins**

- **arya** (server) : backend Node.js basé sur mu-core + mu-agents
- **arya-companion** (mobile) : app Expo/React Native — chat client WebSocket

### Buts

1. **Server arya** : un serveur autonome qui fait tourner des agents mu avec un channel WebSocket pour communiquer avec le companion mobile
2. **Companion mobile** : une app React Native/Expo pour chatter avec les agents, gérer les approbations d'outils, et suivre les sous-agents
3. **Extensibilité** : le cœur fournit les outils `fs`, `shell` et `http`. Des plugins additionnels peuvent être chargés dynamiquement au démarrage depuis `~/.config/arya/plugins/*.ts` (hors repo).
4. **Autonomie** : scheduler cron/heartbeat pour exécuter des tâches automatiques

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    arya (server)                          │
├──────────────────────────────────────────────────────────┤
│  startMu() — mu-core bootstrap                           │
│  ├── createOpenAIProviderPlugin (LLM)                    │
│  ├── createAgentsPlugin (agents, subagents, perms)       │
│  ├── createAryaToolsPlugin (fs, shell, http)             │
│  ├── WebSocketChannel (companion)                        │
│  └── Scheduler (croner)                                  │
└──────────────────────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌──────────────────────────────────────────────────────────┐
│              arya-companion (mobile)                       │
├──────────────────────────────────────────────────────────┤
│  Expo Router + Tamagui UI                                 │
│  ├── ChatScreen (FlashList, streaming)                    │
│  ├── Approval system (approve/deny)                       │
│  ├── SubAgentCard (invocation tracking)                   │
│  ├── Command menu (/)                                     │
│  └── Agent menu (@)                                       │
└──────────────────────────────────────────────────────────┘
```

## 📁 Structure

```
arya-agent/
├── packages/
│   ├── arya/                     # Server backend (mu-core + mu-agents)
│   │   ├── src/
│   │   │   ├── index.ts          # CLI entry point
│   │   │   ├── bootstrap.ts      # startMu() wrapper
│   │   │   ├── ws-channel.ts     # WebSocket channel
│   │   │   ├── scheduler.ts      # Cron/heartbeat tasks
│   │   │   └── plugins/
│   │   │       └── tools/        # Tool plugins (fs, shell, http)
│   │   ├── bin/
│   │   │   └── arya.js           # CLI entry (arya init | arya)
│   │   └── package.json
│   │
│   └── arya-companion/           # Mobile app (Expo/React Native)
│       ├── app/                  # Expo Router screens
│       ├── src/
│       │   ├── lib/ws.ts         # WebSocket client types
│       │   └── components/       # Chat, Approval, SubAgentCard
│       └── package.json
│
├── definitions/                  # Agent & task definitions (local dev)
│   ├── agents/
│   │   └── assistant.md          # Agent definition (mu format)
│   └── tasks/
│       └── default.yaml          # Scheduled tasks
│
├── .env.example                  # Environment variables template
├── packages/arya/templates/config.json  # Config template (used by `arya init`)
├── package.json                  # Workspace root
└── tsconfig.json
```

## 🚀 Quick Start

### Prérequis

- [Bun](https://bun.sh) ou Node.js 20+
- [Ollama](https://ollama.com) avec un modèle (ex: `qwen2.5-coder:7b`)

### Installation

```bash
# Installez les dépendances
cd arya-agent
bun install

# Configurez Ollama
ollama pull qwen2.5-coder:7b

# Initialisez la configuration XDG
npx arya init
# Crée ~/.config/arya/{config.json, agents/, tasks/}
```

### Lancement

```bash
# Mode développement (hot reload)
bun run dev

# Ou en production
bun run start
```

Le serveur démarre sur le port **3001** (configurable via `~/.config/arya/config.json`).

## 📝 Agent Definition

Les agents sont définis dans des fichiers `.md` avec frontmatter YAML.
mu-agents charge automatiquement les fichiers depuis `~/.config/arya/agents/`.

```markdown
---
id: assistant
description: Assistant général pour arya-agent
type: primary
enabled: true
model: qwen2.5-coder:7b
tools:
  read_file: allow
  write_file:
    "src/**": allow
    "**/.env": deny
    "**": ask
  list_dir: allow
  shell:
    "git *": allow
    "**": ask
  http_fetch: allow
  subagent: ask
---
You are a helpful assistant powered by arya-agent. You can use tools to interact
with the filesystem, execute shell commands, and make HTTP requests.

For sensitive operations (write_file on unknown paths, shell commands), you will
need approval from the user.
```

**Champs frontmatter :**
- `id` : Identifiant unique (canonique)
- `description` : Description courte
- `type` : `primary` ou `subagent`
- `enabled` : `true`/`false` (défaut: `true`)
- `model` : `provider/model-id` (optionnel)
- `tools` : Map de permissions
  - Simple : `tool_name: allow|deny|ask`
  - Avec globs : `tool_name: { "glob/pattern": allow|deny|ask, ... }`
- **Body** : Système prompt

**Outils disponibles :**
| Outil | Description | matchKey |
|-------|-------------|----------|
| `read` | Lire un fichier texte | `path` |
| `write` | Écrire un fichier | `path` |
| `edit` | Remplacer une portion exacte | `path` |
| `list_dir` | Lister un répertoire | `path` |
| `bash` | Exécuter une commande bash | `cmd` |
| `http.fetch` | Requêtes HTTP | `url` |
| `subagent` | Déclencher un sous-agent | aucun |

## 📅 Task Definition

Format YAML dans `~/.config/arya/tasks/` ou `definitions/tasks/` :

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

## 🔌 WebSocket Protocol

**Companion → Server :**

```json
// Chat message
{ "type": "chat", "text": "Hello!", "sessionId": "default" }

// Command
{ "type": "command", "text": "/help", "sessionId": "default" }

// Commands/agents re-fetch
{ "type": "commands" }
{ "type": "agents" }

// Approval response
{ "type": "approval_response", "token": "...", "action": "approve" | "deny" }
```

**Server → Companion :**

```json
// Streaming response
{ "type": "stream", "text": "partial...", "sessionId": "default" }

// Done
{ "type": "done", "text": "full response", "sessionId": "default" }

// Approval request
{ "type": "approval_request", "requestId": "...", "token": "...", "toolName": "write_file", "toolArgs": {...}, "agentId": "assistant" }

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

## 🔧 Configuration

### XDG Config (`~/.config/arya/`)

```json
{
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5-coder:7b",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 60000,
  "wsPort": 3001,
  "authToken": ""
}
```

### Environment Variables

All runtime configuration lives in `~/.config/arya/config.json`. Environment
variables are reserved for plugin integrations — each plugin defines its own
env vars. See `.env.example` for the loading mechanism.

## 🧱 Briques mu

arya-consomme les packages mu suivants :

| Package | Rôle |
|---------|------|
| `mu-core` | Agent loop orchestration, sessions, channels, plugins SDK, JSONL session store |
| `mu-agents` | Agent switcher, sub-agents, permissions, approval gateway |
| `mu-openai-provider` | Provider OpenAI-compatible (Ollama, vLLM, etc.) |
| `mu-tools` | Outils partagés `read`, `write`, `edit`, `bash`, `list_dir` |
| `mu-scheduler` | Runner cron pour tâches autonomes |

## 🔌 Ajouter des Outils

Le repo ne ship que `http.fetch` localement (`packages/arya/src/plugins/tools/`).
Les outils filesystem + shell viennent de `mu-tools` (partagé avec
mu-coding). Des plugins additionnels peuvent être chargés dynamiquement
au démarrage depuis `~/.config/arya/plugins/*.ts` — ces plugins ne vivent
pas dans ce repo.

Pour ajouter un plugin :

1. Créez `~/.config/arya/plugins/<nom>.ts`
2. Exportez une factory (`createXxx`) retournant soit un `Plugin`
   (`{ name, tools: [...] }`) soit un `PluginTool` unique
   (`{ definition, permission, execute }`).
3. Installez ses dépendances dans `$XDG_DATA_HOME/arya/plugins/node_modules`
   (ou `~/.local/share/arya/plugins/node_modules`).

Chaque outil doit déclarer :
- `definition.function.name` — nom utilisé dans les permissions
- `permission.matchKey` — fonction qui extrait la clé de glob depuis les args
- `execute(args, signal)` — logique de l'outil

## 📜 License

MIT

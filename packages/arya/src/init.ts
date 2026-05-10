import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Resolve the XDG config home directory. */
function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

/**
 * Initialize arya configuration in ~/.config/arya/.
 *
 * Creates:
 *   ~/.config/arya/config.json          — LLM + WebSocket config
 *   ~/.config/arya/agents/arya.md        — Default agent definition
 *   ~/.config/arya/tasks/default.yaml    — Default scheduled tasks
 *   ~/.config/arya/plugins/              — Plugin config directory (empty)
 *
 * Existing files are never overwritten.
 */
export function init(): void {
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

  // Create config.json (only if it doesn't exist)
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5-coder:7b',
          maxTokens: 4096,
          temperature: 0.7,
          streamTimeoutMs: 60000,
          wsPort: 3001,
          authToken: '',
          plugins: ['arya-tools'],
        },
        null,
        2,
      ),
    );
  }

  // Create agent template (only if it doesn't exist)
  const agentPath = join(configDir, 'agents', 'arya.md');
  if (!existsSync(agentPath)) {
    writeFileSync(
      agentPath,
      `---
id: arya
description: Default Arya primary agent
type: primary
enabled: true
color: '#3B82F6'
tools:
  fs.read_file: allow
  fs.write_file: ask
  fs.list_dir: allow
  shell.execute: ask
  http.fetch: allow
  subagent: ask
---
You are Arya, an autonomous assistant powered by arya-agent. You can use tools to interact with the filesystem, execute shell commands, and make HTTP requests. For sensitive operations, you will need approval from the user.

You may delegate work to subagents when appropriate. Use the \`subagent\` tool with a clear task description.`,
    );
  }

  // Create tasks template (only if it doesn't exist)
  const tasksPath = join(configDir, 'tasks', 'default.yaml');
  if (!existsSync(tasksPath)) {
    writeFileSync(
      tasksPath,
      `- id: hello-task
  agent: arya
  cron: "0 9 * * *"
  channel: companion
  prompt: Say hello and introduce yourself.

- id: daily-summary
  agent: arya
  cron: "0 20 * * *"
  channel: companion
  prompt: Summarize the day's activities and any pending tasks.`,
    );
  }

  console.log('✅ Arya initialized!');
  console.log(`   Config: ${configDir}`);
  console.log(`   Agents: ${join(configDir, 'agents')}`);
  console.log(`   Tasks:  ${join(configDir, 'tasks')}`);
}

// Run when executed directly (not imported)
if (import.meta.main) {
  init();
}

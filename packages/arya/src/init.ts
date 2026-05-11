import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // Create config.json (only if it doesn't exist). The canonical template
  // lives in `packages/arya/templates/config.json` — read it from there so
  // we have one source of truth. No inline default: if the template is
  // missing the install is broken and we want a loud failure.
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    const here = dirname(fileURLToPath(import.meta.url));
    const templatePath = join(here, '..', 'templates', 'config.json');
    const template = readFileSync(templatePath, 'utf8');
    writeFileSync(configPath, template);
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

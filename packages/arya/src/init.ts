/**
 * `arya init` — write a default XDG config layout.
 *
 *   ~/.config/arya/config.json
 *   ~/.config/arya/agents/arya.md       (primary, per-agent permissions)
 *   ~/.config/arya/skills/              (empty placeholder)
 *   ~/.config/arya/tasks/default.yaml
 *   ~/.config/arya/plugins/             (empty placeholder)
 *
 * Existing files are NEVER overwritten.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createXdgPaths } from 'mu-harness';

const CONFIG_TEMPLATE = `${JSON.stringify(
  {
    kind: 'llama-swap',
    baseUrl: 'http://localhost:8080',
    model: 'qwen2.5-coder:7b',
    wsPort: 3001,
    authToken: '',
  },
  null,
  2,
)}\n`;

const AGENT_TEMPLATE = `---
name: arya
description: Default Arya primary agent
type: primary
color: '#3B82F6'
tools:
  read: allow
  list_dir: allow
  webfetch: allow
  write:
    "**/.env*": deny
    "**": ask
  edit:
    "**/.env*": deny
    "**": ask
  bash:
    "git *": allow
    "**": ask
  subagent: ask
  subagent_parallel: ask
---
You are Arya, an autonomous primary assistant powered by arya-agent. You can
use tools to interact with the filesystem, execute shell commands, fetch URLs,
and delegate work to sub-agents. Sensitive operations will prompt the user.
`;

const TASKS_TEMPLATE = `# Example scheduled tasks. Edit or remove as needed.
# - id: daily-hello
#   cron: "0 9 * * *"
#   prompt: Say hello and summarize anything pending.
`;

export function init(): void {
  const paths = createXdgPaths('arya');
  const dirs = [paths.agentsDir, paths.skillsDir, paths.tasksDir, paths.pluginsDir];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  const files: Array<[string, string]> = [
    [paths.configFile, CONFIG_TEMPLATE],
    [`${paths.agentsDir}/arya.md`, AGENT_TEMPLATE],
    [`${paths.tasksDir}/default.yaml`, TASKS_TEMPLATE],
  ];
  for (const [path, content] of files) {
    if (!existsSync(path)) writeFileSync(path, content);
  }

  console.log('Arya initialized!');
  console.log(`  Config: ${paths.configDir}`);
  console.log(`  Agents: ${paths.agentsDir}`);
  console.log(`  Skills: ${paths.skillsDir}`);
  console.log(`  Tasks:  ${paths.tasksDir}`);
}

if (import.meta.main) {
  init();
}

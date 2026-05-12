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

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Resolve templates dir relative to this file (works both when run
  // from `bun run src/init.ts` and from a packaged install). The
  // canonical templates live in `packages/arya/templates/` — single
  // source of truth. Missing templates fail loud (broken install).
  const here = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(here, '..', 'templates');

  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    const template = readFileSync(join(templatesDir, 'config.json'), 'utf8');
    writeFileSync(configPath, template);
  }

  const agentPath = join(configDir, 'agents', 'arya.md');
  if (!existsSync(agentPath)) {
    const agentTemplate = readFileSync(join(templatesDir, 'agent.md'), 'utf8');
    writeFileSync(agentPath, agentTemplate);
  }

  const tasksPath = join(configDir, 'tasks', 'default.yaml');
  if (!existsSync(tasksPath)) {
    const tasksTemplate = readFileSync(join(templatesDir, 'tasks.yaml'), 'utf8');
    writeFileSync(tasksPath, tasksTemplate);
  }

  console.log('✅ Arya initialized!');
  console.log(`   Config: ${configDir}`);
  console.log(`   Agents: ${join(configDir, 'agents')}`);
  console.log(`   Tasks:  ${join(configDir, 'tasks')}`);
}

if (import.meta.main) {
  init();
}

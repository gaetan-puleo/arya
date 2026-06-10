import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { aryaDirs } from './xdg';

const CONFIG_TEMPLATE = `${
  JSON.stringify(
    {
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'qwen2.5-coder:7b',
      primaryAgent: 'arya',
      wsPort: 3001,
      wsHost: '127.0.0.1',
      authToken: '',
    },
    null,
    2,
  )
}\n`;

export function init(): void {
  const dirs = aryaDirs('arya');
  for (const dir of [dirs.agentsDir, dirs.pluginsDir]) mkdirSync(dir, { recursive: true });

  // Arya ships with a built-in `arya` agent (see default-agents.ts) — init does
  // not generate one. Drop your own .md in the agents dir only to customize.
  const files: Array<[string, string]> = [
    [dirs.configFile, CONFIG_TEMPLATE],
  ];
  for (const [path, content] of files) {
    if (!existsSync(path)) writeFileSync(path, content);
  }

  console.log('Arya initialized!');
  console.log(`  Config: ${dirname(dirs.configFile)}`);
  console.log(`  Agents: ${dirs.agentsDir}`);
}

if (import.meta.main) {
  init();
}

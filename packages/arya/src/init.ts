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

const AGENT_TEMPLATE = `---
name: arya
description: Default Arya primary agent
tools:
  - read
  - list_dir
  - webfetch
  - write
  - edit
  - bash
  - subagent
---
You are Arya, an autonomous primary assistant powered by arya-agent. You can
use tools to interact with the filesystem, execute shell commands, fetch URLs,
and delegate work to sub-agents. Sensitive operations prompt the user for
approval before running.
`;

export function init(): void {
  const dirs = aryaDirs('arya');
  for (const dir of [dirs.agentsDir, dirs.pluginsDir]) mkdirSync(dir, { recursive: true });

  const files: Array<[string, string]> = [
    [dirs.configFile, CONFIG_TEMPLATE],
    [`${dirs.agentsDir}/arya.md`, AGENT_TEMPLATE],
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

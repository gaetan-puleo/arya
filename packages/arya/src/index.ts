#!/usr/bin/env node
'use strict';

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { bootstrap } from './bootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

// Resolve config in priority order:
//   1. $XDG_CONFIG_HOME/arya/config.json (or ~/.config/arya/config.json)
//   2. <workspace>/config.json (project-local override, kept for dev)
// No bundled / example fallback — bootstrap refuses to start without an
// explicit config so misconfigurations fail loud instead of silently
// pointing at the wrong endpoint.
const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
const candidates = [
  join(xdgConfig, 'arya', 'config.json'),
  join(root, 'config.json'),
];
let configPath: string | undefined;
for (const c of candidates) {
  try {
    readFileSync(c, 'utf8');
    configPath = c;
    break;
  } catch {
  }
}
if (!configPath) {
  console.error(
    `[arya] No config found. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
      `       Run \`arya init\` to create one at ${candidates[0]}.`,
  );
  process.exit(1);
}

console.log(`[arya] Starting in ${root}`);
console.log(`[arya] Config: ${configPath}`);

try {
  await bootstrap(root, configPath);
} catch (err) {
  console.error(`[arya] Fatal error:`, err);
  process.exit(1);
}

#!/usr/bin/env bun
'use strict';

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

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
let configPath;
for (const c of candidates) {
  try {
    readFileSync(c, 'utf8');
    configPath = c;
    break;
  } catch {
    // try next
  }
}

const command = process.argv[2];

// Init command
if (command === 'init') {
  const { init } = await import(`file://${join(__dirname, '../src/init.ts')}`);
  init();
}
// Install plugin dependencies
else if (command === 'install' || command === 'i') {
  const depsDir = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'arya', 'plugins');
  console.log(`[arya] Installing plugin dependencies in ${depsDir}...`);
  try {
    execSync(`bun install`, { cwd: depsDir, stdio: 'inherit' });
    console.log(`[arya] Done. Dependencies installed in ${depsDir}/node_modules`);
  } catch (err) {
    console.error(`[arya] Failed to install dependencies:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
// Default: start arya
else {
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
    const { bootstrap } = await import(`file://${join(__dirname, '../src/bootstrap.ts')}`);
    await bootstrap(root, configPath);
  } catch (err) {
    console.error(`[arya] Fatal error:`, err);
    process.exit(1);
  }
}

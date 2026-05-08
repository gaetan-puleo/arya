#!/usr/bin/env node
'use strict';

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { bootstrap } from './bootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

// Load config
let configPath = join(root, 'config.json');
try {
  readFileSync(configPath, 'utf8');
} catch {
  configPath = join(root, 'config.example.json');
}

console.log(`[arya] Starting in ${root}`);
console.log(`[arya] Config: ${configPath}`);

try {
  await bootstrap(root, configPath);
} catch (err) {
  console.error(`[arya] Fatal error:`, err);
  process.exit(1);
}

#!/usr/bin/env -S deno run -A --sloppy-imports
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../src/index.ts');
await import(`file://${entry}`);

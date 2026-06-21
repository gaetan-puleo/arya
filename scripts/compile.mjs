#!/usr/bin/env node
// Cross-compile the `arya` CLI into standalone binaries with @yao-pkg/pkg.
// Bundles the server into one self-contained ESM file (tsup), then produces a
// native executable per target. node:sqlite needs Node >= 24, so we target node24.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARYA = resolve(ROOT, 'packages/arya');
const BUNDLE = resolve(ARYA, 'bundle/arya.js');
const DIST = resolve(ROOT, 'dist');

const TARGETS = [
  { target: 'node24-linux-x64', out: 'arya-linux-x64' },
  { target: 'node24-linux-arm64', out: 'arya-linux-arm64' },
  { target: 'node24-macos-x64', out: 'arya-macos-x64' },
  { target: 'node24-macos-arm64', out: 'arya-macos-arm64' },
  { target: 'node24-win-x64', out: 'arya-windows-x64.exe' },
];

const only = process.argv.slice(2);
const selected = only.length > 0 ? TARGETS.filter((t) => only.some((o) => t.target.includes(o) || t.out.includes(o))) : TARGETS;

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

console.log('Bundling the arya server into one self-contained ESM file…');
run('pnpm', ['--filter', 'arya', 'build'], ROOT);

for (const { target, out } of selected) {
  console.log(`\n=== ${out}  (${target}) ===`);
  run('pnpm', ['exec', 'pkg', BUNDLE, '--targets', target, '--no-bytecode', '--public', '--output', resolve(DIST, out)], ROOT);
}

console.log(`\nDone — binaries in ${DIST}`);

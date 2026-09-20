import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: bump-version.js <version>');
  process.exit(1);
}

const targets = [
  'packages/arya/package.json',
  'packages/arya-core/package.json',
];

for (const path of targets) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`bumped ${json.name} -> ${version}`);
}

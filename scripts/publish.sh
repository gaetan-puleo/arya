#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @arya-ai/arya --filter @arya-ai/arya-core pack

shopt -s nullglob
for tgz in arya-ai-*.tgz; do
  echo "Publishing $tgz"
  npm publish "$tgz" --access public
done

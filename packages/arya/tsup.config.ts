import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Standalone-binary build: bundle the server (its own src + the mu-* packages +
// npm deps) into one self-contained ESM file that @yao-pkg/pkg turns into a native
// binary. node: builtins stay external (provided by the embedded Node).
const BUNDLE = 'bundle/arya.js';

export default defineConfig({
  entry: { arya: 'src/index.ts' },
  format: 'esm',
  dts: false,
  clean: true,
  outDir: 'bundle',
  noExternal: [/.*/],
  splitting: false,
  platform: 'node',
  target: 'node22',
  // Provide a real `require` in the ESM bundle so esbuild's `__require` shim uses
  // it instead of throwing "Dynamic require not supported" (some CJS deps, e.g. ws,
  // require node builtins at runtime).
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // esbuild doesn't know the recent `node:sqlite` builtin (used by mu-harness) and
  // strips the prefix to a bare `sqlite` import that fails at runtime. Re-add it.
  onSuccess: async () => {
    const code = readFileSync(BUNDLE, 'utf8').replaceAll('from "sqlite"', 'from "node:sqlite"');
    writeFileSync(BUNDLE, code);
  },
});

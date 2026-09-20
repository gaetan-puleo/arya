import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/arya/src/**/*.test.ts', 'packages/arya-core/src/**/*.test.ts'],
    globals: true,
    server: {
      deps: {
        // node:sqlite is newer than vite 5's builtin list; keep it a runtime builtin.
        external: [/^node:sqlite/],
      },
    },
  },
});

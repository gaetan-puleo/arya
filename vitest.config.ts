import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/arya/src/**/*.test.ts'],
    globals: true,
  },
});

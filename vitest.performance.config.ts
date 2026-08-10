import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.perf.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    pool: 'forks',
  },
});

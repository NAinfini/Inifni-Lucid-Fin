import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/dist/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      thresholds: {
        'apps/desktop-main/src/logger.ts': {
          statements: 65,
          branches: 60,
          functions: 55,
          lines: 68,
        },
        'apps/desktop-main/src/startup-metrics.ts': {
          statements: 75,
          branches: 55,
          functions: 100,
          lines: 88,
        },
        'apps/desktop-main/src/ipc/handlers/job.handlers.ts': {
          statements: 90,
          branches: 66,
          functions: 75,
          lines: 96,
        },
        'apps/desktop-main/src/ipc/handlers/workflow.handlers.ts': {
          statements: 87,
          branches: 100,
          functions: 66,
          lines: 87,
        },
      },
      include: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/__tests__/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
    },
  },
});

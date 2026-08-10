import { defineConfig } from 'vitest/config';
import { ctsPlugin } from './vitest.config.js';

export default defineConfig({
  plugins: [ctsPlugin()],
  test: {
    root: 'apps/desktop-main',
    pool: 'vmForks',
    exclude: ['**/dist/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: '../../coverage/critical',
      all: true,
      include: [
        'src/logger.ts',
        'src/startup-metrics.ts',
        'src/ipc/handlers/job.handlers.ts',
        'src/ipc/handlers/workflow.handlers.ts',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 30,
        lines: 40,
        'src/logger.ts': {
          statements: 65,
          branches: 60,
          functions: 55,
          lines: 68,
        },
        'src/startup-metrics.ts': {
          statements: 75,
          branches: 55,
          functions: 100,
          lines: 88,
        },
        'src/ipc/handlers/job.handlers.ts': {
          statements: 90,
          branches: 66,
          functions: 75,
          lines: 96,
        },
        'src/ipc/handlers/workflow.handlers.ts': {
          statements: 87,
          branches: 100,
          functions: 66,
          lines: 87,
        },
      },
    },
  },
});

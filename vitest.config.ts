import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Rolldown (Vite 8) doesn't recognise .cts as TypeScript — it parses
 * the file as JS and chokes on `type` imports.  This plugin resolves
 * `.cjs` test imports to a virtual `.ts` ID so rolldown's parser
 * treats the source as TypeScript.
 */
function ctsPlugin(): Plugin {
  const CTS_SUFFIX = '?cts-source.ts';

  return {
    name: 'cts-as-ts',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source.endsWith('.cjs') && importer) {
        const dir = importer.replace(/[\\/][^\\/]+$/, '');
        const ctsPath = resolve(dir, source.replace(/\.cjs$/, '.cts'));
        return ctsPath + CTS_SUFFIX;
      }
      return null;
    },
    async load(id) {
      if (id.endsWith(CTS_SUFFIX)) {
        const realPath = id.slice(0, -CTS_SUFFIX.length);
        const code = await readFile(realPath, 'utf-8');
        return { code, map: null };
      }
    },
  };
}

export default defineConfig({
  plugins: [ctsPlugin()],
  test: {
    pool: 'vmForks',
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

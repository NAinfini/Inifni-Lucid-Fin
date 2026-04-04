import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '**/*.e2e.ts',
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['html', { open: 'never' }]],
  projects: [
    {
      name: 'electron',
      use: {
        // Electron tests use _electron fixture, not browser
      },
    },
  ],
});

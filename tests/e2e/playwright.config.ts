import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testIgnore: 'target/**',
  timeout: 60_000,
  // Every Electron instance binds the same local API port, so the suite must run serially.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
  },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
});

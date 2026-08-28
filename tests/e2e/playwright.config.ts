import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  // Keep one disposable Electron profile active at a time on CI.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
  },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
});

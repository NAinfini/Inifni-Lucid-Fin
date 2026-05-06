import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
  },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
});

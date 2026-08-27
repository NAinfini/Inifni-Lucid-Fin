import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './target',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  globalSetup: './target/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'target-fixture-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
